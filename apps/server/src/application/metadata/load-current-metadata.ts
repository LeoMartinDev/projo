import { ok, type Result } from '@projo/shared'

import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import { type ItemMetadata, movieMetadata } from '../../core/metadata/enrichment.ts'
import type { MetadataItemRepository, MetadataSettings } from '../../core/metadata/ports.ts'
import type { TmdbError } from '../../core/metadata/tmdb.ts'
import { refreshContextFactory } from './shared/refresh-context.ts'
import { itemAncestorsFactory, loadSeriesFactory, metadataFor } from './shared/series-tree.ts'
import type { TmdbDetails } from './shared/tmdb-details.ts'

type Deps = {
  details: Pick<TmdbDetails, 'movie' | 'series' | 'season'>
  items: Pick<MetadataItemRepository, 'findItem'>
  refreshRepository: Pick<MetadataRefreshRepository, 'libraryOf'>
  settings: Pick<MetadataSettings, 'language'>
}

const STORED_DETAILS_MAX_AGE_MS = 30 * 24 * 60 * 60_000

/** The metadata TMDB gives the item today, in its deciding library's context. */
export const loadCurrentMetadataFactory = ({
  details,
  items,
  refreshRepository,
  settings,
}: Deps) => {
  const contextOf = refreshContextFactory({ refreshRepository, settings })
  const ancestorsOf = itemAncestorsFactory({ items })
  const loadSeries = loadSeriesFactory({ details })

  return async (itemId: string): Promise<Result<ItemMetadata | undefined, TmdbError>> => {
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
  }
}

export type LoadCurrentMetadata = ReturnType<typeof loadCurrentMetadataFactory>
