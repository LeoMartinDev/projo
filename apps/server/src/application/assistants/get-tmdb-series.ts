import { ok, type Result } from '@projo/shared'

import type { TmdbError, TmdbSeason, TmdbSeries } from '../../core/metadata/tmdb.ts'
import { DETAILS_MAX_AGE_MS } from '../metadata/resolve-match.ts'
import type { TmdbDetails } from '../metadata/tmdb-details.ts'

type Deps = {
  tmdbDetails: Pick<TmdbDetails, 'series' | 'season'>
  metadataLanguage: () => string
}

export type TmdbSeriesView = { series: TmdbSeries; season?: TmdbSeason }

export const getTmdbSeriesFactory =
  ({ tmdbDetails, metadataLanguage }: Deps) =>
  async ({
    tmdbId,
    seasonNumber,
    language = metadataLanguage(),
  }: {
    tmdbId: number
    seasonNumber?: number
    language?: string
  }): Promise<Result<TmdbSeriesView, TmdbError>> => {
    const series = await tmdbDetails.series({ tmdbId, language, maxAgeMs: DETAILS_MAX_AGE_MS })
    if (!series.ok) return series
    if (seasonNumber === undefined) return ok({ series: series.value })
    const season = await tmdbDetails.season({
      seriesTmdbId: tmdbId,
      seasonNumber,
      language,
      maxAgeMs: DETAILS_MAX_AGE_MS,
    })
    if (!season.ok) return season
    return ok({ series: series.value, season: season.value })
  }

export type GetTmdbSeries = ReturnType<typeof getTmdbSeriesFactory>
