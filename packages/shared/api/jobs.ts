import { z } from 'zod'

import { itemKindSchema } from './catalog.ts'
import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'

export const jobTypes = [
  'scan_library',
  'watch_pending',
  'probe_source',
  'match_source',
  'fetch_images',
  'index_keyframes',
  'fetch_segments',
  'fingerprint_season',
  'submit_segment',
  'trickplay',
  'preview_clip',
  'extract_subtitles',
  'refresh_metadata',
  'check_updates',
  'apply_update',
  'cleanup_cache',
  'purge_missing',
  'image_variants',
] as const
export const jobTypeSchema = z.enum(jobTypes)
export type JobTypeDto = z.infer<typeof jobTypeSchema>

export const jobStates = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export const jobStateSchema = z.enum(jobStates)
export type JobStateDto = z.infer<typeof jobStateSchema>

export const adminJobsQuerySchema = paginationQuerySchema.extend({
  state: jobStateSchema.optional(),
  type: jobTypeSchema.optional(),
})
export type AdminJobsQuery = z.infer<typeof adminJobsQuerySchema>

export const jobTargetItemDtoSchema = z.object({
  kind: itemKindSchema,
  title: z.string().optional(),
  seriesTitle: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
})
export type JobTargetItemDto = z.infer<typeof jobTargetItemDtoSchema>

export const jobTargetDtoSchema = z.object({
  kind: z.enum(['library', 'source', 'item', 'season', 'version']),
  id: z.string(),
  label: z.string().optional(),
  item: jobTargetItemDtoSchema.optional(),
})
export type JobTargetDto = z.infer<typeof jobTargetDtoSchema>

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

export const adminJobResponseSchema = adminJobDtoSchema
export type AdminJobResponse = AdminJobDto

export const jobRefSchema = z.object({ jobId: z.string() })
export type JobRef = z.infer<typeof jobRefSchema>
