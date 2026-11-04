import { z } from 'zod'

export const progressUpdateSchema = z.object({
  positionMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
})
export type ProgressUpdate = z.infer<typeof progressUpdateSchema>

export const progressStateSchema = z.enum(['unwatched', 'in_progress', 'watched'])
export type ProgressState = z.infer<typeof progressStateSchema>

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

export const watchStatusDtoSchema = z.object({
  state: z.enum(['unwatched', 'partial', 'watched']),
  watchedCount: z.number().int(),
  inProgressCount: z.number().int(),
  totalCount: z.number().int(),
})
export type WatchStatusDto = z.infer<typeof watchStatusDtoSchema>

export const progressResponseSchema = z.object({
  itemId: z.string(),
  progress: itemProgressDtoSchema.optional(),
  watchStatus: watchStatusDtoSchema.optional(),
})
export type ProgressResponse = z.infer<typeof progressResponseSchema>

export const hideFromContinueResponseSchema = z.object({
  itemId: z.string(),
  hiddenItemId: z.string(),
})
export type HideFromContinueResponse = z.infer<typeof hideFromContinueResponseSchema>
