import { type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LeavingFiles } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import {
  episodeMetadata,
  type ItemMetadata,
  movieMetadata,
  seasonMetadata,
  selectPeople,
  seriesMetadata,
  withoutLocked,
} from '../../core/metadata/enrichment.ts'
import type { LinkedItemInfo } from '../../core/metadata/linking.ts'
import type { MetadataItemRepository, MetadataSettings } from '../../core/metadata/ports.ts'
import type { TmdbError, TmdbSeason, TmdbSeries } from '../../core/metadata/tmdb.ts'
import { requestImages } from './match-source.ts'
import type { TmdbDetails } from './tmdb-details.ts'

type Deps = {
  details: TmdbDetails
  items: Pick<
    MetadataItemRepository,
    'transaction' | 'findItem' | 'lockedFields' | 'writeMetadata' | 'replacePeople'
  >
  refreshRepository: MetadataRefreshRepository
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  ids: IdGenerator
  clock: Clock
  logger: Logger
}

export const IN_PRODUCTION_REFRESH_MS = 7 * 24 * 60 * 60_000
export const LIBRARY_REFRESH_PRIORITY = 10
const STORED_DETAILS_MAX_AGE_MS = 30 * 24 * 60 * 60_000

export type RefreshMetadataError = AppError<
  'metadata/tmdb_unavailable' | 'metadata/tmdb_invalid_response'
>

const RATING_FALLBACK_COUNTRY = 'US'

export const refreshDedupeKey = (itemId: string) => `refresh:${itemId}`
export const libraryRefreshDedupeKey = (libraryId: string) => `library-refresh:${libraryId}`

const isOutage = (error: TmdbError): error is RefreshMetadataError =>
  error.code === 'metadata/tmdb_unavailable' || error.code === 'metadata/tmdb_invalid_response'

const inheritedOf = (series: ItemMetadata) => ({
  genres: series.genres,
  ...(series.contentRating === undefined ? {} : { contentRating: series.contentRating }),
  ...(series.contentRatingCountry === undefined
    ? {}
    : { contentRatingCountry: series.contentRatingCountry }),
  ...(series.originalLanguage === undefined ? {} : { originalLanguage: series.originalLanguage }),
})

type Outcome = { refreshed: string[] } | { skipped: TmdbError['code'] | 'not_matched' | 'gone' }

export const refreshMetadataFactory = ({
  details,
  items,
  refreshRepository,
  settings,
  jobQueue,
  ids,
  clock,
  logger,
}: Deps) => {
  const contextOf = (itemId: string) => {
    const library = refreshRepository.libraryOf(itemId)
    return {
      language: library?.language ?? settings.language(),
      ratingCountry: library?.ratingCountry ?? RATING_FALLBACK_COUNTRY,
    }
  }

  const ancestorsOf = (item: LinkedItemInfo) => {
    const parent = item.parentId === undefined ? undefined : items.findItem(item.parentId)
    if (item.kind === 'season') return { series: parent }
    const series = parent?.parentId === undefined ? undefined : items.findItem(parent.parentId)
    return { season: parent, series }
  }

  type SeriesTree = {
    series: TmdbSeries
    seriesMetadata: ItemMetadata
    seasons: Map<number, TmdbSeason>
  }

  const loadSeries = async (
    seriesTmdbId: number,
    seasonNumbers: readonly number[],
    context: { language: string; ratingCountry: string },
    maxAgeMs: number,
  ): Promise<Result<SeriesTree, TmdbError>> => {
    const series = await details.series({
      tmdbId: seriesTmdbId,
      language: context.language,
      maxAgeMs,
    })
    if (!series.ok) return series
    const seasons = new Map<number, TmdbSeason>()
    for (const seasonNumber of new Set(seasonNumbers)) {
      const season = await details.season({
        seriesTmdbId,
        seasonNumber,
        language: context.language,
        maxAgeMs,
      })
      if (season.ok) seasons.set(seasonNumber, season.value)
      else if (season.error.code !== 'metadata/tmdb_not_found') return season
    }
    return ok({
      series: series.value,
      seriesMetadata: seriesMetadata(series.value, context.ratingCountry),
      seasons,
    })
  }

  const seasonNumbersOf = (seasons: readonly LinkedItemInfo[]) =>
    seasons.flatMap((season) => (season.seasonNumber === undefined ? [] : [season.seasonNumber]))

  const metadataFor = (loaded: SeriesTree, item: LinkedItemInfo): ItemMetadata | undefined => {
    const inherited = inheritedOf(loaded.seriesMetadata)
    switch (item.kind) {
      case 'series':
        return loaded.seriesMetadata
      case 'season': {
        const season =
          item.seasonNumber === undefined ? undefined : loaded.seasons.get(item.seasonNumber)
        return season === undefined ? undefined : seasonMetadata(season, inherited)
      }
      case 'episode': {
        const season =
          item.seasonNumber === undefined ? undefined : loaded.seasons.get(item.seasonNumber)
        const episode = season?.episodes.find((e) => e.episodeNumber === item.episodeNumber)
        return episode === undefined ? undefined : episodeMetadata(episode, inherited)
      }
      default:
        return undefined
    }
  }

  const write = (id: string, metadata: ItemMetadata, language: string) =>
    items.writeMetadata({
      id,
      patch: withoutLocked(metadata, items.lockedFields(id)),
      language,
      refreshedAt: clock.now(),
    })

  const queueRefreshes = (itemIds: readonly string[]) => {
    for (const itemId of itemIds) {
      jobQueue.enqueue({
        type: 'refresh_metadata',
        payload: { itemId },
        dedupeKey: refreshDedupeKey(itemId),
        priority: LIBRARY_REFRESH_PRIORITY,
      })
    }
    return itemIds.length
  }

  const staleLanguage = (libraryId?: string) =>
    refreshRepository.staleLanguage({
      serverLanguage: settings.language(),
      ...(libraryId === undefined ? {} : { libraryId }),
    })

  const staleTrees = (
    topIds: readonly string[],
    countryBefore?: ReadonlyMap<string, string>,
  ): string[] =>
    refreshRepository
      .treeStates({ topIds, serverLanguage: settings.language() })
      .filter(
        (state) =>
          state.stale ||
          (countryBefore !== undefined && countryBefore.get(state.topId) !== state.ratingCountry),
      )
      .map((state) => state.topId)

  const refreshItem = async ({
    itemId,
  }: {
    itemId: string
  }): Promise<Result<Outcome, RefreshMetadataError>> => {
    const item = items.findItem(itemId)
    if (item === undefined) return ok({ skipped: 'gone' })
    if (item.tmdbId === undefined) return ok({ skipped: 'not_matched' })
    const context = contextOf(itemId)
    const fail = (error: TmdbError): Result<Outcome, RefreshMetadataError> => {
      if (isOutage(error)) return err(error)
      logger.info('metadata refresh skipped', { itemId, code: error.code })
      return ok({ skipped: error.code })
    }

    if (item.kind === 'movie') {
      const movie = await details.movie({
        tmdbId: item.tmdbId,
        language: context.language,
        maxAgeMs: 0,
      })
      if (!movie.ok) return fail(movie.error)
      items.transaction(() => {
        write(item.id, movieMetadata(movie.value, context.ratingCountry), context.language)
        items.replacePeople({
          itemId: item.id,
          people: selectPeople(movie.value.credits),
          newId: () => ids.next(),
        })
      })
      requestImages(jobQueue, [item.id])
      logger.info('metadata refreshed', { itemId })
      return ok({ refreshed: [item.id] })
    }

    const { series: seriesItem, season: seasonItem } =
      item.kind === 'series' ? { series: item, season: undefined } : ancestorsOf(item)
    if (seriesItem?.tmdbId === undefined) return ok({ skipped: 'not_matched' })
    const seasons =
      item.kind === 'series'
        ? refreshRepository.children(item.id).filter((child) => child.kind === 'season')
        : item.kind === 'season'
          ? [item]
          : seasonItem === undefined
            ? []
            : [seasonItem]
    const loaded = await loadSeries(seriesItem.tmdbId, seasonNumbersOf(seasons), context, 0)
    if (!loaded.ok) return fail(loaded.error)
    const tree = loaded.value

    const targets: LinkedItemInfo[] =
      item.kind === 'episode'
        ? [item]
        : [
            ...(item.kind === 'series' ? [item] : []),
            ...seasons.flatMap((season) => [
              season,
              ...refreshRepository.children(season.id).filter((child) => child.kind === 'episode'),
            ]),
          ]
    const refreshed: string[] = []
    items.transaction(() => {
      for (const target of targets) {
        const metadata = metadataFor(tree, target)
        if (metadata === undefined) continue
        write(target.id, metadata, context.language)
        refreshed.push(target.id)
      }
      if (item.kind === 'series') {
        items.replacePeople({
          itemId: item.id,
          people: selectPeople(tree.series.credits, tree.series.createdBy),
          newId: () => ids.next(),
        })
      }
    })
    requestImages(jobQueue, refreshed)
    logger.info('metadata refreshed', { itemId, items: refreshed.length })
    return ok({ refreshed })
  }

  return {
    refreshItem,

    currentMetadata: async (
      itemId: string,
    ): Promise<Result<ItemMetadata | undefined, TmdbError>> => {
      const item = items.findItem(itemId)
      if (item?.tmdbId === undefined) return ok(undefined)
      const context = contextOf(itemId)
      if (item.kind === 'movie') {
        const movie = await details.movie({
          tmdbId: item.tmdbId,
          language: context.language,
          maxAgeMs: STORED_DETAILS_MAX_AGE_MS,
        })
        return movie.ok ? ok(movieMetadata(movie.value, context.ratingCountry)) : movie
      }
      const { series: seriesItem } = item.kind === 'series' ? { series: item } : ancestorsOf(item)
      if (seriesItem?.tmdbId === undefined) return ok(undefined)
      const loaded = await loadSeries(
        seriesItem.tmdbId,
        item.seasonNumber === undefined || item.kind === 'series' ? [] : [item.seasonNumber],
        context,
        STORED_DETAILS_MAX_AGE_MS,
      )
      return loaded.ok ? ok(metadataFor(loaded.value, item)) : loaded
    },

    queueLibrary: ({ libraryId }: { libraryId: string }): number => {
      const queued = queueRefreshes(refreshRepository.identifiedTopLevel(libraryId))
      logger.info('library metadata refresh queued', { libraryId, items: queued })
      return queued
    },

    queueStaleLanguage: (): number => {
      const queued = queueRefreshes(staleLanguage())
      logger.info('stale metadata language refresh queued', { items: queued })
      return queued
    },

    queueLibraryContextChange: ({
      libraryId,
      language,
      ratingCountry,
    }: {
      libraryId: string
      language: boolean
      ratingCountry: boolean
    }): number => {
      const itemIds = new Set([
        ...(language ? staleLanguage(libraryId) : []),
        ...(ratingCountry ? refreshRepository.decidedBy(libraryId) : []),
      ])
      const queued = queueRefreshes([...itemIds].sort())
      logger.info('library metadata context refresh queued', { libraryId, items: queued })
      return queued
    },

    queueIfContextDiffers: ({
      itemId,
      language,
      ratingCountry,
    }: {
      itemId: string
      language: string
      ratingCountry: string
    }): boolean => {
      const context = contextOf(itemId)
      const differs = context.language !== language || context.ratingCountry !== ratingCountry
      if (!differs && staleTrees([itemId]).length === 0) return false
      queueRefreshes([itemId])
      logger.info('metadata refresh queued for the deciding library', { itemId })
      return true
    },

    filesLeaving: (files: LeavingFiles): (() => number) => {
      const topIds = refreshRepository.topLevelWithFiles(files)
      if (topIds.length === 0) return () => 0
      const before = new Map(
        refreshRepository
          .treeStates({ topIds, serverLanguage: settings.language() })
          .map((state) => [state.topId, state.ratingCountry]),
      )
      return () => {
        const queued = queueRefreshes(staleTrees(topIds, before))
        if (queued > 0)
          logger.info('metadata refresh queued for a new deciding library', { items: queued })
        return queued
      }
    },

    queueInProductionSeries: (): number => {
      const before = new Date(clock.now().getTime() - IN_PRODUCTION_REFRESH_MS)
      const itemIds = refreshRepository.inProductionSeriesRefreshedBefore(before)
      for (const itemId of itemIds) {
        jobQueue.enqueue({
          type: 'refresh_metadata',
          payload: { itemId },
          dedupeKey: refreshDedupeKey(itemId),
        })
      }
      if (itemIds.length > 0)
        logger.info('in-production series refresh queued', { items: itemIds.length })
      return itemIds.length
    },
  }
}

export type RefreshMetadata = ReturnType<typeof refreshMetadataFactory>
