import { z } from 'zod'

import { itemSummaryDtoSchema, playTargetDtoSchema } from './catalog.ts'
import { genreIdSchema } from './genres.ts'

/**
 * `GET /home` (§13.3): the whole home screen in one request. `rows` keeps the fixed order of
 * §13.3 and leaves empty rows out.
 */

/**
 * Hero: `item` is the movie or the series (backdrop, logo, metadata line, overview, `inWatchlist`),
 * `play` its main button ("Resume S2 · E4", "Play"), `episode` the episode it plays (series).
 */
export const homeHeroDtoSchema = z.object({
  item: itemSummaryDtoSchema.extend({
    overview: z.string().optional(),
    genres: z.array(genreIdSchema),
  }),
  episode: itemSummaryDtoSchema.optional(),
  play: playTargetDtoSchema.optional(),
  /**
   * `/api/v1/previews/:itemId.mp4` (`preview_clip`, §13.3): 20 s of the movie or of the series'
   * most recent episode, played muted over the backdrop on desktop. Absent until it is ready.
   */
  previewUrl: z.string().optional(),
})
export type HomeHeroDto = z.infer<typeof homeHeroDtoSchema>

/** "Up next" card: the next episode (with `series`), "New episode" badge. */
export const upNextEntryDtoSchema = z.object({
  episode: itemSummaryDtoSchema,
  isNew: z.boolean(),
})
export type UpNextEntryDto = z.infer<typeof upNextEntryDtoSchema>

/**
 * The frame a "Continue watching" card shows (§13.3): the timeline thumbnail (§10.5) at the
 * resume position, as a cell of a sprite sheet (`/api/v1/trickplay/:sourceId/<n>.jpg`). `x`, `y`,
 * `width`, `height` locate the cell in the sheet of `sheetWidth × sheetHeight` pixels. Absent
 * until the sprites of the file exist: the card keeps its metadata image.
 */
export const resumeFrameDtoSchema = z.object({
  url: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sheetWidth: z.number().int().positive(),
  sheetHeight: z.number().int().positive(),
})
export type ResumeFrameDto = z.infer<typeof resumeFrameDtoSchema>

/** A card of "Continue watching": the item, and the frame it stopped at when known. */
export const continueWatchingEntryDtoSchema = itemSummaryDtoSchema.extend({
  resumeFrame: resumeFrameDtoSchema.optional(),
})
export type ContinueWatchingEntryDto = z.infer<typeof continueWatchingEntryDtoSchema>

export const homeRowDtoSchema = z.discriminatedUnion('kind', [
  /** 16:9 cards: movies and episodes in progress (`progress`, `series` on episodes). */
  z.object({
    kind: z.literal('continue_watching'),
    items: z.array(continueWatchingEntryDtoSchema),
  }),
  z.object({ kind: z.literal('up_next'), items: z.array(upNextEntryDtoSchema) }),
  /** 2:3 posters, movies and series mixed; "See all" → Movies or Shows sorted by `added`. */
  z.object({ kind: z.literal('recently_added'), items: z.array(itemSummaryDtoSchema) }),
  /** 16:9 cards; "See all" → `GET /watchlist`. */
  z.object({ kind: z.literal('watchlist'), items: z.array(itemSummaryDtoSchema) }),
])
export type HomeRowDto = z.infer<typeof homeRowDtoSchema>

export const homeDtoSchema = z.object({
  hero: homeHeroDtoSchema.optional(),
  rows: z.array(homeRowDtoSchema),
})
export type HomeDto = z.infer<typeof homeDtoSchema>

// ── Categories (§13.3 item 6) ────────────────────────────────────────────────

/**
 * A category row: "Anime" (genre `animation` and Japanese original language, §11.1), or one
 * genre (§9.1, the "Animation" row without the anime). Titled by the web (`home.rows.anime`,
 * `genres.<id>`).
 */
export const homeCategoryDtoSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('anime') }),
  z.object({ kind: z.literal('genre'), genre: genreIdSchema }),
])
export type HomeCategoryDto = z.infer<typeof homeCategoryDtoSchema>

/** A stable key of a category, unique among the rows: `anime`, `genre-action`… */
export const homeCategoryKey = (category: HomeCategoryDto): string =>
  category.kind === 'anime' ? 'anime' : `genre-${category.genre}`

/** 2:3 posters, movies and series mixed, newest first, the watched ones last. */
export const homeCategoryRowDtoSchema = z.object({
  category: homeCategoryDtoSchema,
  items: z.array(itemSummaryDtoSchema),
})
export type HomeCategoryRowDto = z.infer<typeof homeCategoryRowDtoSchema>

/**
 * `GET /home/categories?cursor=`: one batch of category rows, in their §13.3 order. `cursor` is
 * the `nextCursor` of the previous batch (absent: the first one); `total` counts every row of the
 * list, so the client reserves the room of the next batch; no `nextCursor` after the last batch.
 */
export const homeCategoriesQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^\d{1,4}$/u, 'a cursor is a nextCursor of a previous batch')
    .optional(),
})
export const homeCategoriesDtoSchema = z.object({
  rows: z.array(homeCategoryRowDtoSchema),
  total: z.number().int().min(0),
  nextCursor: z.string().optional(),
})
export type HomeCategoriesDto = z.infer<typeof homeCategoriesDtoSchema>
