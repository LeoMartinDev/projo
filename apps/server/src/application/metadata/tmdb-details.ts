import { ok, type Result } from '@projo/shared'

import {
  episodeNeedsFallback,
  FALLBACK_LANGUAGE,
  mergeEpisodeFallback,
  mergeFallback,
  needsFallback,
} from '../../core/metadata/enrichment.ts'
import type {
  TmdbApi,
  TmdbError,
  TmdbMovie,
  TmdbSeason,
  TmdbSeries,
} from '../../core/metadata/tmdb.ts'

const isNotFound = (error: TmdbError): boolean => error.code === 'metadata/tmdb_not_found'

/**
 * TMDB details of an identified item in the metadata language, titles and overviews missing in it
 * completed from en-US (§9.1). `maxAgeMs`: a response stored in the database no older than that is
 * reused (0: always asked again, the refresh of §9.4).
 */
export const tmdbDetailsFactory = ({ tmdb }: { tmdb: TmdbApi }) => ({
  movie: async (input: {
    tmdbId: number
    language: string
    maxAgeMs: number
  }): Promise<Result<TmdbMovie, TmdbError>> => {
    const movie = await tmdb.movie(input)
    if (!movie.ok || !needsFallback(movie.value, input.language)) return movie
    const english = await tmdb.movie({ ...input, language: FALLBACK_LANGUAGE })
    if (!english.ok) return isNotFound(english.error) ? movie : english
    return ok(mergeFallback(movie.value, english.value, input.language))
  },

  series: async (input: {
    tmdbId: number
    language: string
    maxAgeMs: number
  }): Promise<Result<TmdbSeries, TmdbError>> => {
    const series = await tmdb.series(input)
    if (!series.ok || !needsFallback(series.value, input.language)) return series
    const english = await tmdb.series({ ...input, language: FALLBACK_LANGUAGE })
    if (!english.ok) return isNotFound(english.error) ? series : english
    return ok(mergeFallback(series.value, english.value, input.language))
  },

  season: async (input: {
    seriesTmdbId: number
    seasonNumber: number
    language: string
    maxAgeMs: number
  }): Promise<Result<TmdbSeason, TmdbError>> => {
    const season = await tmdb.season(input)
    if (!season.ok) return season
    const value = season.value
    if (!value.episodes.some((episode) => episodeNeedsFallback(episode, input.language))) {
      return season
    }
    const english = await tmdb.season({ ...input, language: FALLBACK_LANGUAGE })
    if (!english.ok) return isNotFound(english.error) ? season : english
    const overview = value.overview ?? english.value.overview
    return ok({
      ...value,
      ...(overview === undefined ? {} : { overview }),
      episodes: value.episodes.map((episode) =>
        mergeEpisodeFallback(
          episode,
          english.value.episodes.find((e) => e.episodeNumber === episode.episodeNumber),
        ),
      ),
    })
  },
})

export type TmdbDetails = ReturnType<typeof tmdbDetailsFactory>
