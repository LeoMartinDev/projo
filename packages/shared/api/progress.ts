import { z } from 'zod'

/** Schemas for progress (§17.2 Progression, §13.1); "My list" is in `watchlist.ts`. */

/** `PUT /items/:id/progress` (movie or episode). */
export const progressUpdateSchema = z.object({
  positionMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
})
export type ProgressUpdate = z.infer<typeof progressUpdateSchema>

/**
 * `in_progress` = position between 2 % and 93 % of the duration ("Reprendre"), `watched` =
 * marked seen (93 % reached or manual). `resumePositionMs` is where playback should start: 0
 * outside the "Reprendre" window (a watched item starts over).
 */
export const progressStateSchema = z.enum(['unwatched', 'in_progress', 'watched'])
export type ProgressState = z.infer<typeof progressStateSchema>

/** Progress of the active profile on a movie or an episode. */
export const itemProgressDtoSchema = z.object({
  state: progressStateSchema,
  watched: z.boolean(),
  positionMs: z.number().int(),
  durationMs: z.number().int(),
  resumePositionMs: z.number().int(),
  playCount: z.number().int(),
  lastPlayedAt: z.string().optional(),
  watchedAt: z.string().optional(),
})
export type ItemProgressDto = z.infer<typeof itemProgressDtoSchema>

/** Season or series, derived from its visible episodes (never stored). */
export const watchStatusDtoSchema = z.object({
  state: z.enum(['unwatched', 'partial', 'watched']),
  watchedCount: z.number().int(),
  inProgressCount: z.number().int(),
  totalCount: z.number().int(),
})
export type WatchStatusDto = z.infer<typeof watchStatusDtoSchema>

/**
 * Answer of `PUT /items/:id/progress`, `POST|DELETE /items/:id/watched`: the item's own state
 * (`progress` on a movie or episode, `watchStatus` on a season or series).
 */
export const progressResponseSchema = z.object({
  itemId: z.string(),
  progress: itemProgressDtoSchema.optional(),
  watchStatus: watchStatusDtoSchema.optional(),
})
export type ProgressResponse = z.infer<typeof progressResponseSchema>

/**
 * `POST /items/:id/hide-from-continue` ("Remove", §13.1): on a movie, removes it from "Continue
 * watching"; on an episode, a season or a series, removes the series from "Continue
 * watching" and "Up next". Undone by the next play. `hiddenItemId` is the movie or the series.
 */
export const hideFromContinueResponseSchema = z.object({
  itemId: z.string(),
  hiddenItemId: z.string(),
})
export type HideFromContinueResponse = z.infer<typeof hideFromContinueResponseSchema>
