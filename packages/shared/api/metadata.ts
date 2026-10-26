import { z } from 'zod'

import { genreIdSchema, MAX_ITEM_GENRES } from './genres.ts'

/**
 * Schemas of the TMDB identification admin (§7.8 "To review", §9.2, §17.2 Admin items and
 * sources): TMDB search, assignment of a source, rejection, re-identification of an item.
 */

/** Why a source waits in "To review" (§7.8). */
export const reviewReasonSchema = z.enum([
  'classification_ambiguous',
  'no_match',
  'ambiguous_match',
  'episode_not_found',
  'absolute_numbering',
  'date_based',
  'hint_conflict',
  'no_episode_number',
])
export type ReviewReason = z.infer<typeof reviewReasonSchema>

// ── TMDB search ──────────────────────────────────────────────────────────────

export const tmdbSearchKindSchema = z.enum(['movie', 'series'])
export type TmdbSearchKind = z.infer<typeof tmdbSearchKindSchema>

/** `GET /admin/tmdb/search?q=&kind=&year=&language=`. */
export const tmdbSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  kind: tmdbSearchKindSchema,
  year: z.coerce.number().int().min(1870).max(2200).optional(),
  /** BCP 47; absent = server metadata language. */
  language: z.string().min(2).max(16).optional(),
})
export type TmdbSearchQuery = z.infer<typeof tmdbSearchQuerySchema>

export const tmdbSearchResultSchema = z.object({
  tmdbId: z.number().int(),
  kind: tmdbSearchKindSchema,
  title: z.string(),
  originalTitle: z.string().optional(),
  year: z.number().int().optional(),
  overview: z.string().optional(),
  /**
   * TMDB poster path (`/abc.jpg`). Never hotlinked: the web shows it through
   * `GET /admin/tmdb/posters/:file` (w185, proxied by the server).
   */
  posterPath: z.string().optional(),
  popularity: z.number().optional(),
})
export type TmdbSearchResult = z.infer<typeof tmdbSearchResultSchema>

export const tmdbSearchResponseSchema = z.object({ items: z.array(tmdbSearchResultSchema) })
export type TmdbSearchResponse = z.infer<typeof tmdbSearchResponseSchema>

/**
 * `GET /admin/tmdb/posters/:file?size=`: w185 (search results, poster alternatives) or w300
 * (backdrop alternatives).
 */
export const tmdbPreviewSizeSchema = z.enum(['w185', 'w300'])
export type TmdbPreviewSize = z.infer<typeof tmdbPreviewSizeSchema>

// ── Assignment (§7.8) ────────────────────────────────────────────────────────

const positive = z.number().int().min(0).max(100_000)

/**
 * `POST /admin/sources/:id/assign` and `POST /admin/items/:id/rematch`.
 * - `movie`: "it's a movie" + the chosen TMDB movie;
 * - `episode`: "it's an episode of…": the TMDB series, season and episode default to what the
 *   file name says (season 1 when it says nothing); a multi-episode file keeps its span from
 *   that episode on. On a source keeping its file name's
 *   numbers, the other files to review of its series in the same show folder follow (§7.8);
 * - `series` (rematch of a series item only): every episode file of the item moves to that
 *   series, same season and episode numbers.
 */
export const assignBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('movie'), tmdbId: z.number().int().positive() }),
  z.object({
    kind: z.literal('episode'),
    seriesTmdbId: z.number().int().positive(),
    seasonNumber: positive.optional(),
    episodeNumber: positive.optional(),
  }),
  z.object({ kind: z.literal('series'), tmdbId: z.number().int().positive() }),
])
export type AssignBody = z.infer<typeof assignBodySchema>

/**
 * Result of an assignment or a rematch: the sources touched and the items they now belong to.
 * `needsReview` (rematch of a series, episode of a source with other files to review): episode
 * files the series has no episode for, left in "To review" (`episode_not_found`) while the others
 * moved.
 */
export const assignResponseSchema = z.object({
  sourceIds: z.array(z.string()),
  itemIds: z.array(z.string()),
  needsReview: z.array(
    z.object({ sourceId: z.string(), seasonNumber: z.number(), episodeNumber: z.number() }),
  ),
})
export type AssignResponse = z.infer<typeof assignResponseSchema>

// ── Editing and locks (§9.3) ─────────────────────────────────────────────────

/**
 * Editable fields (§9.3) of a movie, series, season or episode. Each edit locks the field (a row of
 * `item_overrides`: `poster` ↔ `poster_image_id`, `backdrop` ↔ `backdrop_image_id`) and a
 * refresh no longer overwrites it. Rating, cast, vote and runtime are not editable.
 */
export const editableFieldSchema = z.enum([
  'title',
  'year',
  'overview',
  'genres',
  'poster',
  'backdrop',
])
export type EditableField = z.infer<typeof editableFieldSchema>

/** Slots an admin can choose or upload an image for. */
export const editableImageKindSchema = z.enum(['poster', 'backdrop'])
export type EditableImageKind = z.infer<typeof editableImageKindSchema>

/**
 * `GET /admin/items/:id`: the item as the editor shows it, and the answer of every edit below.
 * Values are what users see (overrides applied); `locked`: the fields with an override ("Back to the
 * TMDB value" shown on them). Images: `/api/v1/images/:id`.
 */
export const itemMetadataDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['movie', 'series', 'season', 'episode']),
  /** Absent on a local item: no refresh, no TMDB alternatives (`metadata/not_matched`). */
  tmdbId: z.number().int().optional(),
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title: z.string().optional(),
  year: z.number().int().optional(),
  overview: z.string().optional(),
  genres: z.array(genreIdSchema),
  images: z.object({ poster: z.string().optional(), backdrop: z.string().optional() }),
  locked: z.array(editableFieldSchema),
  metadataRefreshedAt: z.string().optional(),
})
export type ItemMetadataDto = z.infer<typeof itemMetadataDtoSchema>

/**
 * `PATCH /admin/items/:id` (§17.2 "overrides"): the text fields given are stored and locked. Images
 * go through `POST /admin/items/:id/images`. 200 `ItemMetadataDto`.
 */
export const updateItemMetadataBodySchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    year: z.number().int().min(1870).max(2200),
    overview: z.string().trim().max(10_000),
    /** §9.3: chosen from the fixed list (§9.1), in the admin's order, duplicates dropped. */
    genres: z
      .array(genreIdSchema)
      .max(MAX_ITEM_GENRES)
      .transform((genres) => [...new Set(genres)]),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'expected at least one field' })
export type UpdateItemMetadataBody = z.infer<typeof updateItemMetadataBodySchema>

/**
 * `DELETE /admin/items/:id/overrides/:field` ("Back to the TMDB value"): removes the lock and puts the TMDB
 * value back at once when it is cached (otherwise at the next refresh). Idempotent; 200
 * `ItemMetadataDto`.
 */
export const overrideFieldParamSchema = z.object({ field: editableFieldSchema })
export type OverrideFieldParam = z.infer<typeof overrideFieldParamSchema>

// `POST /admin/items/:id/refresh` (§9.4 "Refresh button"): 202 `{ jobId }` (`api/jobs`), a
// `refresh_metadata` job; 409 `metadata/not_matched` on a local item. Same answer for
// `POST /admin/libraries/:id/refresh-metadata` ("Refresh the whole library": one low-priority
// job walking its identified items one at a time, locks respected).

/** `GET /admin/items/:id/images/alternatives?kind=` (§9.3: TMDB `/images`). */
export const imageAlternativesQuerySchema = z.object({ kind: editableImageKindSchema })
export type ImageAlternativesQuery = z.infer<typeof imageAlternativesQuerySchema>

/**
 * One TMDB image of the item (movie, series; season: its posters and the series backdrops;
 * episode: the series images), best voted first. Shown through the admin TMDB image proxy
 * (`GET /admin/tmdb/posters/:file`), never hotlinked.
 */
export const imageAlternativeDtoSchema = z.object({
  tmdbPath: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  language: z.string().optional(),
  voteAverage: z.number().optional(),
  /** The image the item uses now. */
  current: z.boolean(),
})
export type ImageAlternativeDto = z.infer<typeof imageAlternativeDtoSchema>

export const imageAlternativesResponseSchema = z.object({
  items: z.array(imageAlternativeDtoSchema),
})
export type ImageAlternativesResponse = z.infer<typeof imageAlternativesResponseSchema>

/** §9.3: uploads of JPEG, PNG or WebP up to 10 MB (checked by magic bytes, §20). */
export const maxImageUploadBytes = 10 * 1024 * 1024

/**
 * `POST /admin/items/:id/images`, two bodies:
 * - JSON `{ kind, tmdbPath }`: a TMDB alternative, downloaded (posters w500, backdrops w1280);
 * - `multipart/form-data` `kind` + `file`: an upload, re-encoded by ffmpeg into `images/custom/`
 *   (415 `image/unsupported_type`, 413 `image/too_large`, 422 `image/unreadable`).
 * Either way the slot is locked (`poster` / `backdrop` override). 200 `ItemMetadataDto`.
 */
export const chooseItemImageBodySchema = z.object({
  kind: editableImageKindSchema,
  tmdbPath: z.string().regex(/^\/[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/u),
})
export type ChooseItemImageBody = z.infer<typeof chooseItemImageBodySchema>

export const uploadItemImageFormSchema = z.object({
  kind: editableImageKindSchema,
  file: z.instanceof(File),
})
export type UploadItemImageForm = z.infer<typeof uploadItemImageFormSchema>
