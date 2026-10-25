import type { AppError, Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

/**
 * TMDB v3 (§9.1), as the domain sees it. The adapter (`infrastructure/tmdb/`) validates every
 * response with Zod, maps it to these shapes and owns concurrency, retries, timeouts and caches.
 */

export type TmdbError = AppError<
  | 'metadata/tmdb_key_missing'
  | 'metadata/tmdb_unauthorized'
  | 'metadata/tmdb_unavailable'
  | 'metadata/tmdb_not_found'
  | 'metadata/tmdb_invalid_response'
>

export type TmdbSearchHit = {
  tmdbId: number
  title: string
  originalTitle?: string
  /** Release year (movie) or first air year (series). */
  year?: number
  overview?: string
  posterPath?: string
  popularity: number
  voteCount: number
  /** Not from the search: added by the matcher when no title is close enough (§9.2). */
  alternativeTitles?: string[]
}

export type TmdbImage = {
  path: string
  /** `iso_639_1`; undefined = no text (textless backdrop, etc.). */
  language?: string
  width: number
  height: number
  voteAverage: number
}

export type TmdbImages = { posters: TmdbImage[]; backdrops: TmdbImage[]; logos: TmdbImage[] }

export type TmdbCastMember = {
  tmdbId: number
  name: string
  character?: string
  order: number
  profilePath?: string
}

export type TmdbCrewMember = {
  tmdbId: number
  name: string
  job: string
  department: string
  profilePath?: string
}

export type TmdbCredits = { cast: TmdbCastMember[]; crew: TmdbCrewMember[] }

/** `release_dates` (movies) and `content_ratings` (series), flattened: one entry per rating. */
export type TmdbRating = { country: string; rating: string; type?: number }

type TmdbWork = {
  tmdbId: number
  title: string
  originalTitle?: string
  overview?: string
  /** projo genre ids (§9.1), converted from the TMDB genre ids by the adapter. */
  genres: GenreId[]
  originalLanguage?: string
  voteAverage?: number
  posterPath?: string
  backdropPath?: string
  images: TmdbImages
  credits: TmdbCredits
  ratings: TmdbRating[]
  imdbId?: string
  tvdbId?: number
}

export type TmdbMovie = TmdbWork & {
  releaseDate?: string
  runtimeMinutes?: number
}

export type TmdbSeasonSummary = {
  seasonNumber: number
  episodeCount: number
  airDate?: string
  posterPath?: string
  name?: string
}

export type TmdbSeries = TmdbWork & {
  firstAirDate?: string
  lastAirDate?: string
  status?: string
  inProduction?: boolean
  episodeRunTime?: number
  numberOfEpisodes?: number
  seasons: TmdbSeasonSummary[]
  createdBy: { tmdbId: number; name: string; profilePath?: string }[]
}

export type TmdbEpisode = {
  tmdbId: number
  seasonNumber: number
  episodeNumber: number
  name?: string
  overview?: string
  airDate?: string
  runtimeMinutes?: number
  voteAverage?: number
  stillPath?: string
}

export type TmdbSeason = {
  tmdbId: number
  seasonNumber: number
  name?: string
  overview?: string
  airDate?: string
  posterPath?: string
  episodes: TmdbEpisode[]
}

export type TmdbFindResult = { movieIds: number[]; seriesIds: number[] }

/** Whose `/images` (§9.3 alternatives). */
export type TmdbImagesTarget =
  | { kind: 'movie'; tmdbId: number }
  | { kind: 'series'; tmdbId: number }
  | { kind: 'season'; seriesTmdbId: number; seasonNumber: number }

/** Image sizes of §9.1 / §24. */
export type TmdbImageSize = 'w185' | 'w300' | 'w500' | 'w1280'

/**
 * Detail calls take `maxAgeMs`: a response stored in the database no older than that is reused
 * (§9.2: series and seasons cached in the database). Searches are cached in memory (10 min).
 */
export type TmdbApi = {
  searchMovies: (input: {
    query: string
    year?: number
    language: string
  }) => Promise<Result<TmdbSearchHit[], TmdbError>>
  searchSeries: (input: {
    query: string
    firstAirYear?: number
    language: string
  }) => Promise<Result<TmdbSearchHit[], TmdbError>>
  /** `/find/{id}?external_source=imdb_id|tvdb_id` (§8.1 id tags). */
  find: (input: {
    externalId: string
    source: 'imdb_id' | 'tvdb_id'
  }) => Promise<Result<TmdbFindResult, TmdbError>>
  /**
   * `/movie/{id}/alternative_titles`, `/tv/{id}/alternative_titles`: every country's titles
   * (§9.2, "Star Wars: Episode VI - Return of the Jedi"). Cached in memory like searches.
   */
  alternativeTitles: (input: {
    kind: 'movie' | 'series'
    tmdbId: number
  }) => Promise<Result<string[], TmdbError>>
  movie: (input: {
    tmdbId: number
    language: string
    maxAgeMs?: number
  }) => Promise<Result<TmdbMovie, TmdbError>>
  series: (input: {
    tmdbId: number
    language: string
    maxAgeMs?: number
  }) => Promise<Result<TmdbSeries, TmdbError>>
  season: (input: {
    seriesTmdbId: number
    seasonNumber: number
    language: string
    maxAgeMs?: number
  }) => Promise<Result<TmdbSeason, TmdbError>>
  /**
   * `/movie/{id}/images`, `/tv/{id}/images`, `/tv/{id}/season/{n}/images` in the metadata
   * language, English and textless (§9.1): the editor's alternatives (§9.3). A season has posters
   * only. Cached in memory like searches.
   */
  images: (input: {
    target: TmdbImagesTarget
    language: string
  }) => Promise<Result<TmdbImages, TmdbError>>
  /** Checks a key before it is stored (`/configuration`). */
  validateKey: (key: string) => Promise<Result<void, TmdbError>>
  downloadImage: (input: {
    path: string
    size: TmdbImageSize
  }) => Promise<Result<{ bytes: Uint8Array; contentType: string }, TmdbError>>
}
