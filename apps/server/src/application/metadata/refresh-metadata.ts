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

/** §9.4: weekly for in-production series. */
export const IN_PRODUCTION_REFRESH_MS = 7 * 24 * 60 * 60_000
/** "Refresh the whole library": below the default `refresh_metadata` priority (§18: 20). */
export const LIBRARY_REFRESH_PRIORITY = 10
/** Responses stored at identification are reused to put a TMDB value back (§9.3). */
const STORED_DETAILS_MAX_AGE_MS = 30 * 24 * 60 * 60_000

/** Only a TMDB outage fails the job (retried with backoff, §18). */
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

/**
 * Refresh of TMDB metadata (§9.4): a movie; a series with its seasons and episodes; a season with
 * its episodes; an episode. Locked fields are never written (§9.3); nothing is created nor deleted
 * (a season or an episode TMDB no longer knows keeps what it has). Images missing or changed
 * follow through `fetch_images`.
 */
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

  /** The series above a season or an episode, and the season above an episode. */
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
      // A season TMDB no longer has keeps its metadata.
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

  /** Metadata TMDB gives for these items (series tree: by item id). */
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

  /** One low-priority `refresh_metadata` per movie or series, below the user's own requests. */
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

  /** Trees whose stored language is not the one they resolve to now (§9.4). */
  const staleLanguage = (libraryId?: string) =>
    refreshRepository.staleLanguage({
      serverLanguage: settings.language(),
      ...(libraryId === undefined ? {} : { libraryId }),
    })

  /**
   * Of these movies and series still holding a file, those to refresh (§9.1): stale trees, and
   * (`countryBefore`) those whose deciding library now has another rating country.
   */
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

    /**
     * What TMDB says now for one item, from the responses stored at identification when young
     * enough ("Back to the TMDB value", §9.3). `undefined`: TMDB has no such item any more.
     */
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

    /** "Refresh the whole library": one low-priority job per identified movie or series. */
    queueLibrary: ({ libraryId }: { libraryId: string }): number => {
      const queued = queueRefreshes(refreshRepository.identifiedTopLevel(libraryId))
      logger.info('library metadata refresh queued', { libraryId, items: queued })
      return queued
    },

    /**
     * §9.4, server metadata language changed: every movie or series whose tree holds a row in
     * another language than the one it resolves to now (a library with its own language keeps it).
     */
    queueStaleLanguage: (): number => {
      const queued = queueRefreshes(staleLanguage())
      logger.info('stale metadata language refresh queued', { items: queued })
      return queued
    },

    /**
     * §9.4, a library's metadata language or rating country changed: the movies and series with
     * a file in it whose language differs now, and those it decides (§9.1) for a new country.
     */
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

    /**
     * After an identification (§9.1): written with the settings of the file's library, but the
     * tree follows its deciding library. When they differ (a series in two libraries), the whole
     * movie or series is refreshed with the right ones. When they are the same, the file may
     * have made its library the deciding one: items of the tree written before with other
     * settings refresh it too (one query; a refresh writes the whole tree, nothing queued again).
     */
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

    /**
     * §9.1, files about to leave (library deleted, roots removed, sources purged or moved to
     * another item): the movies and series holding some of them may get another deciding
     * library. Their state is taken now; the returned function, once the files are gone,
     * refreshes those whose tree became stale or whose deciding library has another rating
     * country (the one requested is not stored: the rows follow the former deciding library).
     */
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

    /** §9.4: in-production series not refreshed for a week. */
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
