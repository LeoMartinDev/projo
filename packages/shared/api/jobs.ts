import { z } from 'zod'

import { itemKindSchema } from './catalog.ts'
import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'

/**
 * §15 "Jobs", §17.2 Admin exploitation: `GET /admin/jobs`, `POST /admin/jobs/:id/retry`,
 * `POST /admin/jobs/:id/cancel`. Also the `{ jobId }` answer of the actions that enqueue a job.
 */

/** §18. Every job type of v1 (the server's `core/jobs/job.ts` re-exports this list). */
export const jobTypes = [
  'scan_library',
  'watch_pending',
  'probe_source',
  'match_source',
  'fetch_images',
  'index_keyframes',
  'fetch_segments',
  'fingerprint_season',
  // §12.5: a manual marker submitted to TheIntroDB / SkipDB when contribution is on.
  'submit_segment',
  'trickplay',
  'preview_clip',
  'extract_subtitles',
  'refresh_metadata',
  'check_updates',
  'apply_update',
  'cleanup_cache',
  'purge_missing',
  // §9.1: WebP variants of the stored images that miss them (daily, and after an update).
  'image_variants',
] as const
export const jobTypeSchema = z.enum(jobTypes)
export type JobTypeDto = z.infer<typeof jobTypeSchema>

export const jobStates = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export const jobStateSchema = z.enum(jobStates)
export type JobStateDto = z.infer<typeof jobStateSchema>

/**
 * `GET /admin/jobs?state=&type=&cursor=&limit=`, newest first (UUID v7 order). Without `state`:
 * every state.
 */
export const adminJobsQuerySchema = paginationQuerySchema.extend({
  state: jobStateSchema.optional(),
  type: jobTypeSchema.optional(),
})
export type AdminJobsQuery = z.infer<typeof adminJobsQuerySchema>

/**
 * An `item` or `season` target by its parts; the web composes its line in the interface language
 * ("Severance · S2 · E4", "Severance · Season 2").
 */
export const jobTargetItemDtoSchema = z.object({
  kind: itemKindSchema,
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title: z.string().optional(),
  /** Seasons and episodes: their series. */
  seriesTitle: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
})
export type JobTargetItemDto = z.infer<typeof jobTargetItemDtoSchema>

/**
 * What a job works on ("cible", §15), read from its payload: a library, a source (file), an item,
 * a season, or a version of the app. Named while it exists: `label` for a library (its name), a
 * source (its file name) and a version; `item` for an item or a season.
 */
export const jobTargetDtoSchema = z.object({
  kind: z.enum(['library', 'source', 'item', 'season', 'version']),
  id: z.string(),
  label: z.string().optional(),
  item: jobTargetItemDtoSchema.optional(),
})
export type JobTargetDto = z.infer<typeof jobTargetDtoSchema>

/**
 * The persisted error of a job (`jobs.error`, the `cause` dropped). `code` stays a string: a row
 * written by an older version may carry a code this one no longer declares (the web translates
 * the known ones).
 */
export const jobErrorDtoSchema = z.object({
  code: z.string(),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
})
export type JobErrorDto = z.infer<typeof jobErrorDtoSchema>

export const adminJobDtoSchema = z.object({
  id: z.string(),
  type: jobTypeSchema,
  state: jobStateSchema,
  priority: z.number().int(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  runAfter: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.optional(),
  finishedAt: isoDateTimeSchema.optional(),
  progress: z.number().min(0).max(100).optional(),
  dedupeKey: z.string().optional(),
  target: jobTargetDtoSchema.optional(),
  error: jobErrorDtoSchema.optional(),
})
export type AdminJobDto = z.infer<typeof adminJobDtoSchema>

export const adminJobsPageSchema = z.object({
  items: z.array(adminJobDtoSchema),
  nextCursor: z.string().optional(),
})
export type AdminJobsPage = z.infer<typeof adminJobsPageSchema>

/**
 * `POST /admin/jobs/:id/retry` (a `failed` or `cancelled` job: back to `queued` now, attempts
 * reset, error cleared; else 409 `job/not_retryable`) and `POST /admin/jobs/:id/cancel` (a
 * `queued` or `running` job; else 409 `job/not_cancellable`) answer the job, 200.
 */
export const adminJobResponseSchema = adminJobDtoSchema
export type AdminJobResponse = AdminJobDto

/** 202 answer of an action that enqueued a job (refresh, update check, update): follow it by SSE. */
export const jobRefSchema = z.object({ jobId: z.string() })
export type JobRef = z.infer<typeof jobRefSchema>
