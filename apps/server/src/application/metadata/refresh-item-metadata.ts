import { type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import {
  type ItemMetadata,
  movieMetadata,
  selectPeople,
  withoutLocked,
} from '../../core/metadata/enrichment.ts'
import type { LinkedItemInfo } from '../../core/metadata/linking.ts'
import type { MetadataItemRepository, MetadataSettings } from '../../core/metadata/ports.ts'
import type { TmdbError } from '../../core/metadata/tmdb.ts'
import { refreshContextFactory } from './shared/refresh-context.ts'
import { requestImages } from './shared/request-images.ts'
import { itemAncestorsFactory, loadSeriesFactory, metadataFor } from './shared/series-tree.ts'
import type { TmdbDetails } from './shared/tmdb-details.ts'

type Deps = {
  details: Pick<TmdbDetails, 'movie' | 'series' | 'season'>
  items: Pick<
    MetadataItemRepository,
    'transaction' | 'findItem' | 'lockedFields' | 'writeMetadata' | 'replacePeople'
  >
  refreshRepository: Pick<MetadataRefreshRepository, 'libraryOf' | 'children'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  ids: IdGenerator
  clock: Clock
  logger: Logger
}

export type RefreshItemMetadataError = AppError<
  'metadata/tmdb_unavailable' | 'metadata/tmdb_invalid_response'
>

const isOutage = (error: TmdbError): error is RefreshItemMetadataError =>
  error.code === 'metadata/tmdb_unavailable' || error.code === 'metadata/tmdb_invalid_response'

export type RefreshItemMetadataOutcome =
  { refreshed: string[] } | { skipped: TmdbError['code'] | 'not_matched' | 'gone' }

const seasonNumbersOf = (seasons: readonly LinkedItemInfo[]) =>
  seasons.flatMap((season) => (season.seasonNumber === undefined ? [] : [season.seasonNumber]))

export const refreshItemMetadataFactory = ({
  details,
  items,
  refreshRepository,
  settings,
  jobQueue,
  ids,
  clock,
  logger,
}: Deps) => {
  const contextOf = refreshContextFactory({ refreshRepository, settings })
  const ancestorsOf = itemAncestorsFactory({ items })
  const loadSeries = loadSeriesFactory({ details })

  const write = (id: string, metadata: ItemMetadata, language: string) =>
    items.writeMetadata({
      id,
      patch: withoutLocked(metadata, items.lockedFields(id)),
      language,
      refreshedAt: clock.now(),
    })

  return async ({
    itemId,
  }: {
    itemId: string
  }): Promise<Result<RefreshItemMetadataOutcome, RefreshItemMetadataError>> => {
    const item = items.findItem(itemId)
    if (item === undefined) return ok({ skipped: 'gone' })
    if (item.tmdbId === undefined) return ok({ skipped: 'not_matched' })
    const context = contextOf(itemId)
    const fail = (
      error: TmdbError,
    ): Result<RefreshItemMetadataOutcome, RefreshItemMetadataError> => {
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
}

export type RefreshItemMetadata = ReturnType<typeof refreshItemMetadataFactory>
