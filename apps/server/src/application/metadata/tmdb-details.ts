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
  TmdbEpisode,
  TmdbError,
  TmdbMovie,
  TmdbSeason,
  TmdbSeries,
} from '../../core/metadata/tmdb.ts'

const isNotFound = (error: TmdbError): boolean => error.code === 'metadata/tmdb_not_found'

type SeasonInput = {
  seriesTmdbId: number
  seasonNumber: number
  language: string
  maxAgeMs: number
}

/**
 * TMDB details of an identified item in the metadata language, titles and overviews missing in it
 * completed from en-US (§9.1). `maxAgeMs`: a response stored in the database no older than that is
 * reused (0: always asked again, the refresh of §9.4). The only implementation of that fallback:
 * the matcher (`resolve-match.ts`) completes what it read through `completeMovie` and
 * `completeSeason`.
 */
export const tmdbDetailsFactory = ({ tmdb }: { tmdb: TmdbApi }) => {
  const completeMovie = async (
    movie: TmdbMovie,
    input: { language: string; maxAgeMs: number },
  ): Promise<Result<TmdbMovie, TmdbError>> => {
    if (!needsFallback(movie, input.language)) return ok(movie)
    const english = await tmdb.movie({
      tmdbId: movie.tmdbId,
      language: FALLBACK_LANGUAGE,
      maxAgeMs: input.maxAgeMs,
    })
    if (!english.ok) return isNotFound(english.error) ? ok(movie) : english
    return ok(mergeFallback(movie, english.value, input.language))
  }

  /** `needs`: the episodes worth an en-US request (default: any episode missing a text). */
  const completeSeason = async (
    season: TmdbSeason,
    input: SeasonInput,
    needs: (episode: TmdbEpisode) => boolean = (episode) =>
      episodeNeedsFallback(episode, input.language),
  ): Promise<Result<TmdbSeason, TmdbError>> => {
    if (!season.episodes.some(needs)) return ok(season)
    const english = await tmdb.season({ ...input, language: FALLBACK_LANGUAGE })
    if (!english.ok) return isNotFound(english.error) ? ok(season) : english
    const overview = season.overview ?? english.value.overview
    return ok({
      ...season,
      ...(overview === undefined ? {} : { overview }),
      episodes: season.episodes.map((episode) =>
        mergeEpisodeFallback(
          episode,
          english.value.episodes.find((e) => e.episodeNumber === episode.episodeNumber),
        ),
      ),
    })
  }

  return {
    completeMovie,
    completeSeason,

    movie: async (input: {
      tmdbId: number
      language: string
      maxAgeMs: number
    }): Promise<Result<TmdbMovie, TmdbError>> => {
      const movie = await tmdb.movie(input)
      return movie.ok ? completeMovie(movie.value, input) : movie
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

    season: async (input: SeasonInput): Promise<Result<TmdbSeason, TmdbError>> => {
      const season = await tmdb.season(input)
      return season.ok ? completeSeason(season.value, input) : season
    },
  }
}

export type TmdbDetails = ReturnType<typeof tmdbDetailsFactory>
