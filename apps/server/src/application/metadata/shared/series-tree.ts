import { ok, type Result } from '@projo/shared'

import {
  episodeMetadata,
  type ItemMetadata,
  seasonMetadata,
  seriesMetadata,
} from '../../../core/metadata/enrichment.ts'
import type { LinkedItemInfo } from '../../../core/metadata/linking.ts'
import type { MetadataItemRepository } from '../../../core/metadata/ports.ts'
import type { TmdbError, TmdbSeason, TmdbSeries } from '../../../core/metadata/tmdb.ts'
import type { RefreshContext } from './refresh-context.ts'
import type { TmdbDetails } from './tmdb-details.ts'

export type SeriesTree = {
  series: TmdbSeries
  seriesMetadata: ItemMetadata
  seasons: Map<number, TmdbSeason>
}

const inheritedOf = (series: ItemMetadata) => ({
  genres: series.genres,
  ...(series.contentRating === undefined ? {} : { contentRating: series.contentRating }),
  ...(series.contentRatingCountry === undefined
    ? {}
    : { contentRatingCountry: series.contentRatingCountry }),
  ...(series.originalLanguage === undefined ? {} : { originalLanguage: series.originalLanguage }),
})

export const itemAncestorsFactory =
  ({ items }: { items: Pick<MetadataItemRepository, 'findItem'> }) =>
  (item: LinkedItemInfo) => {
    const parent = item.parentId === undefined ? undefined : items.findItem(item.parentId)
    if (item.kind === 'season') return { series: parent }
    const series = parent?.parentId === undefined ? undefined : items.findItem(parent.parentId)
    return { season: parent, series }
  }

export const loadSeriesFactory =
  ({ details }: { details: Pick<TmdbDetails, 'series' | 'season'> }) =>
  async (
    seriesTmdbId: number,
    seasonNumbers: readonly number[],
    context: RefreshContext,
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

export const metadataFor = (loaded: SeriesTree, item: LinkedItemInfo): ItemMetadata | undefined => {
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
