import { z } from 'zod'

import { paginationQuerySchema } from './common.ts'
import { contentRatingDtoSchema } from './content-ratings.ts'
import { genreIdSchema } from './genres.ts'
import { itemProgressDtoSchema, watchStatusDtoSchema } from './progress.ts'
import { dynamicRangeSchema, resolutionSchema, sourceVersionDtoSchema } from './versions.ts'

/** Schemas for the catalog (§17.2 Catalogue): home, movies, series, items, search, images. */

export const itemKindSchema = z.enum(['movie', 'series', 'season', 'episode'])
export type ItemKind = z.infer<typeof itemKindSchema>

/**
 * Where a series stands (§9.1, from TMDB): `in_production` (returning, in production, planned,
 * pilot; refreshed weekly, §9.4), `ended`, `canceled`. Absent: unknown status, or a local series.
 */
export const seriesStatuses = ['in_production', 'ended', 'canceled'] as const
export const seriesStatusSchema = z.enum(seriesStatuses)
export type SeriesStatus = z.infer<typeof seriesStatusSchema>

// ── Listing (`GET /movies`, `GET /series`) ───────────────────────────────────

/**
 * §13.4: `title` = `sort_title`, `added` = `added_at` (a series rises when a new episode becomes
 * ready), `year`, `rating` = TMDB `vote_average`. Unknown years and ratings come last.
 */
export const catalogSortSchema = z.enum(['title', 'added', 'year', 'rating'])
export type CatalogSort = z.infer<typeof catalogSortSchema>

/** §13.4 "vu / non vu / en cours"; on a series, `in_progress` = partly watched. */
export const watchFilterSchema = z.enum(['watched', 'unwatched', 'in_progress'])
export type WatchFilter = z.infer<typeof watchFilterSchema>

export const sortOrderSchema = z.enum(['asc', 'desc'])
export type SortOrder = z.infer<typeof sortOrderSchema>

/**
 * `?sort=title|added|year|rating&order=asc|desc&genre=&year=|decade=&watch=&cursor=&limit=`.
 * Defaults: `title` ascending, the others descending (newest, best rated first). A cursor is only
 * valid with the sort and order that produced it (and the same filters). `decade` is its first
 * year (`1990` = 1990–1999); `genre` a genre id (§9.1), as listed by `GET /genres`.
 */
export const catalogListQuerySchema = paginationQuerySchema
  .extend({
    sort: catalogSortSchema.default('title'),
    order: sortOrderSchema.optional(),
    genre: genreIdSchema.optional(),
    year: z.coerce.number().int().min(1800).max(3000).optional(),
    decade: z.coerce
      .number()
      .int()
      .min(1800)
      .max(3000)
      .refine((value) => value % 10 === 0, 'a decade starts on a year ending in 0')
      .optional(),
    watch: watchFilterSchema.optional(),
  })
  .refine((query) => query.year === undefined || query.decade === undefined, {
    message: 'year and decade are exclusive',
    path: ['decade'],
  })
export type CatalogListQuery = z.infer<typeof catalogListQuerySchema>

/**
 * `GET /genres?kind=movie|series`: the facets of Movies / Shows (§13.4): genre ids (§9.1) of the
 * visible movies and / or series, unsorted (the web sorts them by translated label), and `years`, the oldest and newest known year (absent when no
 * item has one), bounds of the year filter.
 */
export const genresQuerySchema = z.object({ kind: z.enum(['movie', 'series']).optional() })
export const genreListSchema = z.object({
  genres: z.array(genreIdSchema),
  years: z.object({ min: z.number().int(), max: z.number().int() }).optional(),
})
export type GenreList = z.infer<typeof genreListSchema>

// ── Items ────────────────────────────────────────────────────────────────────

/**
 * Image URLs (`/api/v1/images/:id`), absent until TMDB enriched the item (§9.1). Formats (§19):
 * `poster` 2:3, `backdrop` and episode `still` 16:9, `logo` transparent (title of the hero).
 */
export const itemImagesDtoSchema = z.object({
  poster: z.string().optional(),
  backdrop: z.string().optional(),
  logo: z.string().optional(),
  still: z.string().optional(),
})
export type ItemImagesDto = z.infer<typeof itemImagesDtoSchema>

/**
 * §9.1 WebP widths of every stored image (those under its own width), for `srcset`. One ladder
 * for every kind: a client does not know whether a 16:9 URL is a still or a backdrop.
 */
export const imageWidths = [185, 342, 500, 780, 1280] as const

/** `GET /images/:id?w=`: a width of the ladder (wider than the image: the full-size WebP). */
export const imageQuerySchema = z.object({
  w: z.coerce
    .number()
    .refine((w) => (imageWidths as readonly number[]).includes(w))
    .optional(),
})

/** Best quality among the ready files ("4K HDR": `2160p` + `hdr`; `dv` = Dolby Vision). */
export const videoQualityDtoSchema = z.object({
  resolution: resolutionSchema,
  dynamicRange: dynamicRangeSchema,
})
export type VideoQualityDto = z.infer<typeof videoQualityDtoSchema>

/** Ancestors of an episode or a season (breadcrumb, "S2 · E4", card fallback images). */
export const itemRefDtoSchema = z.object({
  id: z.string(),
  kind: itemKindSchema,
  /** Absent: a season without a name of its own, labelled from its number (§6.3). */
  title: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  images: itemImagesDtoSchema.optional(),
  /** The series of an episode card in home rows: in the profile's "My list" (§13.3). */
  inWatchlist: z.boolean().optional(),
})
export type ItemRefDto = z.infer<typeof itemRefDtoSchema>

/**
 * A visible item (§6.3), as shown on a card. `progress` is set on movies and episodes,
 * `watchStatus` on series and seasons (derived from their visible episodes: "x of n watched" =
 * `watchedCount` / `totalCount`). TMDB fields are absent until the item is enriched.
 */
export const itemSummaryDtoSchema = z.object({
  id: z.string(),
  kind: itemKindSchema,
  /**
   * Absent: a season or an episode without a name of its own (TMDB's or the file's was "Saison
   * 2", "Episode 7"…, §6.3); clients label it from its number in the interface language.
   */
  title: z.string().optional(),
  sortTitle: z.string(),
  year: z.number().int().optional(),
  /** Series: year of TMDB's last air date ("2023 – 2025"). */
  endYear: z.number().int().optional(),
  parentId: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
  /**
   * Episodes of `GET /items/:id/children` (§8.4): the best ready file of this episode also holds
   * the following ones up to this number ("E01-E02", one card, one playback). Set on the first
   * episode of the range only; the ones it covers are listed too, without it.
   */
  episodeNumberEnd: z.number().int().optional(),
  /** TMDB runtime (M2). */
  runtimeMinutes: z.number().int().optional(),
  /**
   * Movies and episodes: probed duration of the best ready source (`sources.probe`), known
   * without TMDB. Clients show it first, `runtimeMinutes` otherwise.
   */
  durationMs: z.number().int().optional(),
  /**
   * ISO date the first source became ready; on a series or a season, the newest episode's.
   */
  addedAt: z.string().optional(),
  images: itemImagesDtoSchema,
  /** Classification: code, rating country and age tier (`content-ratings.ts`, §9.1). */
  contentRating: contentRatingDtoSchema.optional(),
  /** TMDB rating, 0–10. */
  voteAverage: z.number().optional(),
  /** Seasons and series: episodes known to TMDB, files or not ("12 / 22 episodes"). */
  episodeCountTmdb: z.number().int().optional(),
  /** Series: visible seasons, specials left out when there are others ("Show · 2 seasons"). */
  seasonCount: z.number().int().optional(),
  genres: z.array(genreIdSchema),
  /**
   * Movies, episodes, series: best quality among the ready files (of every visible episode for a
   * series), "4K HDR" on the card preview.
   */
  bestQuality: videoQualityDtoSchema.optional(),
  /** Episodes only (season lists, home rows): summary and first air date. */
  overview: z.string().optional(),
  airDate: z.string().optional(),
  /** Movies and series: in the profile's "My list". */
  inWatchlist: z.boolean().optional(),
  /** Episodes in home rows: their series (title, images for a missing still). */
  series: itemRefDtoSchema.optional(),
  progress: itemProgressDtoSchema.optional(),
  watchStatus: watchStatusDtoSchema.optional(),
})
export type ItemSummaryDto = z.infer<typeof itemSummaryDtoSchema>

export const itemPageSchema = z.object({
  items: z.array(itemSummaryDtoSchema),
  nextCursor: z.string().optional(),
})
export type ItemPage = z.infer<typeof itemPageSchema>

/**
 * A ready file of a movie or an episode, with what the player needs to describe it. `version`:
 * what tells it apart from the other files of the item (§7.7), labelled by the web.
 */
export const sourceDtoSchema = z.object({
  id: z.string(),
  version: sourceVersionDtoSchema,
  partIndex: z.number().int().optional(),
  container: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int().optional(),
  video: z
    .object({
      codec: z.string(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
    })
    .optional(),
  audioTracks: z.array(
    z.object({
      index: z.number().int(),
      codec: z.string(),
      channels: z.number().int().optional(),
      language: z.string().optional(),
      title: z.string().optional(),
      isDefault: z.boolean(),
    }),
  ),
})
export type SourceDto = z.infer<typeof sourceDtoSchema>

/** Cast (§9.1: 20 first actors) and crew (directors, writers), not clickable. */
export const personDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(['cast', 'director', 'writer']),
  character: z.string().optional(),
  /** `/api/v1/images/:id` (photo, w185). */
  photo: z.string().optional(),
})
export type PersonDto = z.infer<typeof personDtoSchema>

/**
 * The main button of a series or season (§13.5), or of the hero: `resume` = "Resume S2 · E4"
 * at `positionMs`, `play` = "Play" that episode from its start.
 */
export const playTargetDtoSchema = z.object({
  action: z.enum(['resume', 'play']),
  itemId: z.string(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
  /** The episode's own title, absent when it has none (§6.3). */
  title: z.string().optional(),
  positionMs: z.number().int(),
})
export type PlayTargetDto = z.infer<typeof playTargetDtoSchema>

/**
 * `GET /items/:id`. `sources` is empty for series and seasons. `play` is set on series and
 * seasons (movies and episodes: `progress.resumePositionMs`). `bestQuality` and the languages
 * cover the ready files of the item, or of every visible episode under it.
 */
export const itemDetailDtoSchema = itemSummaryDtoSchema.extend({
  originalTitle: z.string().optional(),
  overview: z.string().optional(),
  releaseDate: z.string().optional(),
  originalLanguage: z.string().optional(),
  seriesStatus: seriesStatusSchema.optional(),
  season: itemRefDtoSchema.optional(),
  sources: z.array(sourceDtoSchema),
  cast: z.array(personDtoSchema),
  crew: z.array(personDtoSchema),
  /** Series and seasons: first episode in broadcast order ("From the beginning", §13.5). */
  firstEpisodeId: z.string().optional(),
  audioLanguages: z.array(z.string()),
  subtitleLanguages: z.array(z.string()),
  play: playTargetDtoSchema.optional(),
})
export type ItemDetailDto = z.infer<typeof itemDetailDtoSchema>

/** `GET /items/:id/children`: seasons of a series, episodes of a season (not paginated). */
export const itemChildrenSchema = z.object({
  items: z.array(itemSummaryDtoSchema),
})
export type ItemChildren = z.infer<typeof itemChildrenSchema>
