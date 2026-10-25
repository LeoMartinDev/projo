import { z } from 'zod'

import { tmdbGenres } from '../../core/metadata/genres.ts'
import type {
  TmdbCredits,
  TmdbEpisode,
  TmdbFindResult,
  TmdbImage,
  TmdbImages,
  TmdbMovie,
  TmdbRating,
  TmdbSearchHit,
  TmdbSeason,
  TmdbSeries,
} from '../../core/metadata/tmdb.ts'

/**
 * Zod schemas of the TMDB v3 responses projo reads (https://developer.themoviedb.org/reference),
 * and their mapping to the domain types. TMDB sends `null` and `""` for unknown values: both
 * become absent properties.
 */

const absent = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value): z.infer<T> | undefined => value ?? undefined)
const text = absent(z.string()).transform((value) =>
  value === undefined || value.trim() === '' ? undefined : value,
)
const num = absent(z.number())
/** `YYYY-MM-DD`, `""` or null. */
const date = text.transform((value) =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : undefined,
)

const yearOf = (value: string | undefined): number | undefined =>
  value === undefined ? undefined : Number(value.slice(0, 4))

const opt = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

// ── Search, find, configuration ─────────────────────────────────────────────

const movieHitSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  original_title: text,
  release_date: date,
  overview: text,
  poster_path: text,
  popularity: num,
  vote_count: num,
})

const seriesHitSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  original_name: text,
  first_air_date: date,
  overview: text,
  poster_path: text,
  popularity: num,
  vote_count: num,
})

export const movieSearchSchema = z.object({ results: z.array(movieHitSchema) })
export const seriesSearchSchema = z.object({ results: z.array(seriesHitSchema) })

export const toMovieHits = (response: z.infer<typeof movieSearchSchema>): TmdbSearchHit[] =>
  response.results.map((hit) => ({
    tmdbId: hit.id,
    title: hit.title,
    ...opt('originalTitle', hit.original_title),
    ...opt('year', yearOf(hit.release_date)),
    ...opt('overview', hit.overview),
    ...opt('posterPath', hit.poster_path),
    popularity: hit.popularity ?? 0,
    voteCount: hit.vote_count ?? 0,
  }))

export const toSeriesHits = (response: z.infer<typeof seriesSearchSchema>): TmdbSearchHit[] =>
  response.results.map((hit) => ({
    tmdbId: hit.id,
    title: hit.name,
    ...opt('originalTitle', hit.original_name),
    ...opt('year', yearOf(hit.first_air_date)),
    ...opt('overview', hit.overview),
    ...opt('posterPath', hit.poster_path),
    popularity: hit.popularity ?? 0,
    voteCount: hit.vote_count ?? 0,
  }))

const alternativeTitleSchema = z.object({ title: z.string() })

/** Movies list them in `titles`, series in `results`. */
export const alternativeTitlesSchema = z.object({
  titles: z.array(alternativeTitleSchema).optional(),
  results: z.array(alternativeTitleSchema).optional(),
})

export const toAlternativeTitles = (
  response: z.infer<typeof alternativeTitlesSchema>,
): string[] => [
  ...new Set(
    [...(response.titles ?? []), ...(response.results ?? [])]
      .map((entry) => entry.title.trim())
      .filter((title) => title !== ''),
  ),
]

const idOnly = z.object({ id: z.number().int() })

export const findSchema = z.object({
  movie_results: z.array(idOnly).default([]),
  tv_results: z.array(idOnly).default([]),
})

export const toFindResult = (response: z.infer<typeof findSchema>): TmdbFindResult => ({
  movieIds: response.movie_results.map((r) => r.id),
  seriesIds: response.tv_results.map((r) => r.id),
})

export const configurationSchema = z.object({ images: z.object({}).passthrough() })

// ── Shared pieces of details ────────────────────────────────────────────────

/** Only the TMDB genre ids are kept: projo stores its own genre ids, labels come from the web (§9.1). */
const genresSchema = z.array(z.object({ id: z.number().int() })).default([])

/** The TMDB genre ids of a details response. */
export const tmdbGenreIdsOf = (details: { genres: z.infer<typeof genresSchema> }): number[] =>
  details.genres.map((genre) => genre.id)

const imageSchema = z.object({
  file_path: z.string(),
  iso_639_1: text,
  width: num,
  height: num,
  vote_average: num,
})
const imagesSchema = z
  .object({
    posters: z.array(imageSchema).default([]),
    backdrops: z.array(imageSchema).default([]),
    logos: z.array(imageSchema).default([]),
  })
  .default({ posters: [], backdrops: [], logos: [] })

const toImage = (image: z.infer<typeof imageSchema>): TmdbImage => ({
  path: image.file_path,
  ...opt('language', image.iso_639_1),
  width: image.width ?? 0,
  height: image.height ?? 0,
  voteAverage: image.vote_average ?? 0,
})
const toImages = (images: z.infer<typeof imagesSchema>): TmdbImages => ({
  posters: images.posters.map(toImage),
  backdrops: images.backdrops.map(toImage),
  logos: images.logos.map(toImage),
})

/** `/movie/{id}/images`, `/tv/{id}/images`, `/tv/{id}/season/{n}/images` (posters only). */
export const imagesResponseSchema = imagesSchema
export const toImagesResponse = toImages

const creditsSchema = z
  .object({
    cast: z
      .array(
        z.object({
          id: z.number().int(),
          name: z.string(),
          character: text,
          order: num,
          profile_path: text,
        }),
      )
      .default([]),
    crew: z
      .array(
        z.object({
          id: z.number().int(),
          name: z.string(),
          job: absent(z.string()),
          department: absent(z.string()),
          profile_path: text,
        }),
      )
      .default([]),
  })
  .default({ cast: [], crew: [] })

const toCredits = (credits: z.infer<typeof creditsSchema>): TmdbCredits => ({
  cast: credits.cast.map((member, index) => ({
    tmdbId: member.id,
    name: member.name,
    ...opt('character', member.character),
    order: member.order ?? index,
    ...opt('profilePath', member.profile_path),
  })),
  crew: credits.crew.map((member) => ({
    tmdbId: member.id,
    name: member.name,
    job: member.job ?? '',
    department: member.department ?? '',
    ...opt('profilePath', member.profile_path),
  })),
})

const externalIdsSchema = z
  .object({ imdb_id: text, tvdb_id: num })
  .default({ imdb_id: undefined, tvdb_id: undefined })

// ── Movie ───────────────────────────────────────────────────────────────────

export const movieSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  original_title: text,
  overview: text,
  release_date: date,
  runtime: num,
  genres: genresSchema,
  original_language: text,
  vote_average: num,
  poster_path: text,
  backdrop_path: text,
  imdb_id: text,
  credits: creditsSchema,
  images: imagesSchema,
  external_ids: externalIdsSchema,
  release_dates: z
    .object({
      results: z
        .array(
          z.object({
            iso_3166_1: z.string(),
            release_dates: z
              .array(z.object({ certification: absent(z.string()), type: num }))
              .default([]),
          }),
        )
        .default([]),
    })
    .default({ results: [] }),
})

export const toMovie = (movie: z.infer<typeof movieSchema>): TmdbMovie => ({
  tmdbId: movie.id,
  title: movie.title,
  ...opt('originalTitle', movie.original_title),
  ...opt('overview', movie.overview),
  ...opt('releaseDate', movie.release_date),
  ...opt('runtimeMinutes', movie.runtime === 0 ? undefined : movie.runtime),
  genres: tmdbGenres('movie', tmdbGenreIdsOf(movie)).genres,
  ...opt('originalLanguage', movie.original_language),
  ...opt('voteAverage', movie.vote_average),
  ...opt('posterPath', movie.poster_path),
  ...opt('backdropPath', movie.backdrop_path),
  images: toImages(movie.images),
  credits: toCredits(movie.credits),
  ratings: movie.release_dates.results.flatMap((country): TmdbRating[] =>
    country.release_dates.map((release) => ({
      country: country.iso_3166_1,
      rating: release.certification ?? '',
      ...opt('type', release.type),
    })),
  ),
  ...opt('imdbId', movie.external_ids.imdb_id ?? movie.imdb_id),
  ...opt('tvdbId', movie.external_ids.tvdb_id),
})

// ── Series ──────────────────────────────────────────────────────────────────

export const seriesSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  original_name: text,
  overview: text,
  first_air_date: date,
  last_air_date: date,
  status: text,
  in_production: absent(z.boolean()),
  episode_run_time: z.array(z.number()).nullish(),
  number_of_episodes: num,
  genres: genresSchema,
  original_language: text,
  vote_average: num,
  poster_path: text,
  backdrop_path: text,
  seasons: z
    .array(
      z.object({
        season_number: z.number().int(),
        episode_count: num,
        air_date: date,
        poster_path: text,
        name: text,
      }),
    )
    .default([]),
  created_by: z
    .array(z.object({ id: z.number().int(), name: z.string(), profile_path: text }))
    .default([]),
  credits: creditsSchema,
  images: imagesSchema,
  external_ids: externalIdsSchema,
  content_ratings: z
    .object({
      results: z
        .array(z.object({ iso_3166_1: z.string(), rating: absent(z.string()) }))
        .default([]),
    })
    .default({ results: [] }),
})

export const toSeries = (series: z.infer<typeof seriesSchema>): TmdbSeries => ({
  tmdbId: series.id,
  title: series.name,
  ...opt('originalTitle', series.original_name),
  ...opt('overview', series.overview),
  ...opt('firstAirDate', series.first_air_date),
  ...opt('lastAirDate', series.last_air_date),
  ...opt('status', series.status),
  ...opt('inProduction', series.in_production),
  ...opt('episodeRunTime', series.episode_run_time?.[0]),
  ...opt('numberOfEpisodes', series.number_of_episodes),
  genres: tmdbGenres('series', tmdbGenreIdsOf(series)).genres,
  ...opt('originalLanguage', series.original_language),
  ...opt('voteAverage', series.vote_average),
  ...opt('posterPath', series.poster_path),
  ...opt('backdropPath', series.backdrop_path),
  seasons: series.seasons.map((season) => ({
    seasonNumber: season.season_number,
    episodeCount: season.episode_count ?? 0,
    ...opt('airDate', season.air_date),
    ...opt('posterPath', season.poster_path),
    ...opt('name', season.name),
  })),
  createdBy: series.created_by.map((creator) => ({
    tmdbId: creator.id,
    name: creator.name,
    ...opt('profilePath', creator.profile_path),
  })),
  images: toImages(series.images),
  credits: toCredits(series.credits),
  ratings: series.content_ratings.results.map((rating) => ({
    country: rating.iso_3166_1,
    rating: rating.rating ?? '',
  })),
  ...opt('imdbId', series.external_ids.imdb_id),
  ...opt('tvdbId', series.external_ids.tvdb_id),
})

// ── Season ──────────────────────────────────────────────────────────────────

const episodeSchema = z.object({
  id: z.number().int(),
  season_number: z.number().int(),
  episode_number: z.number().int(),
  name: text,
  overview: text,
  air_date: date,
  runtime: num,
  vote_average: num,
  still_path: text,
})

export const seasonSchema = z.object({
  id: z.number().int(),
  season_number: z.number().int(),
  name: text,
  overview: text,
  air_date: date,
  poster_path: text,
  episodes: z.array(episodeSchema).default([]),
})

const toEpisode = (episode: z.infer<typeof episodeSchema>): TmdbEpisode => ({
  tmdbId: episode.id,
  seasonNumber: episode.season_number,
  episodeNumber: episode.episode_number,
  ...opt('name', episode.name),
  ...opt('overview', episode.overview),
  ...opt('airDate', episode.air_date),
  ...opt('runtimeMinutes', episode.runtime === 0 ? undefined : episode.runtime),
  ...opt('voteAverage', episode.vote_average),
  ...opt('stillPath', episode.still_path),
})

export const toSeason = (season: z.infer<typeof seasonSchema>): TmdbSeason => ({
  tmdbId: season.id,
  seasonNumber: season.season_number,
  ...opt('name', season.name),
  ...opt('overview', season.overview),
  ...opt('airDate', season.air_date),
  ...opt('posterPath', season.poster_path),
  episodes: season.episodes.map(toEpisode),
})
