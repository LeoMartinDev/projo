import type { AppError, Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

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
  year?: number
  overview?: string
  posterPath?: string
  popularity: number
  voteCount: number
  alternativeTitles?: string[]
}

export type TmdbImage = {
  path: string
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

export type TmdbRating = { country: string; rating: string; type?: number }

type TmdbWork = {
  tmdbId: number
  title: string
  originalTitle?: string
  overview?: string
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

export type TmdbImagesTarget =
  | { kind: 'movie'; tmdbId: number }
  | { kind: 'series'; tmdbId: number }
  | { kind: 'season'; seriesTmdbId: number; seasonNumber: number }

export type TmdbImageSize = 'w185' | 'w300' | 'w500' | 'w1280'

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
  find: (input: {
    externalId: string
    source: 'imdb_id' | 'tvdb_id'
  }) => Promise<Result<TmdbFindResult, TmdbError>>
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
  images: (input: {
    target: TmdbImagesTarget
    language: string
  }) => Promise<Result<TmdbImages, TmdbError>>
  validateKey: (key: string) => Promise<Result<void, TmdbError>>
  downloadImage: (input: {
    path: string
    size: TmdbImageSize
  }) => Promise<Result<{ bytes: Uint8Array; contentType: string }, TmdbError>>
}
