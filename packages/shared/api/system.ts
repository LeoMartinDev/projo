import { z } from 'zod'

import { isoDateTimeSchema } from './common.ts'
import { scanKindSchema } from './libraries.ts'

export const runningScanDtoSchema = z.object({
  libraryId: z.string(),
  libraryName: z.string(),
  scanRunId: z.string(),
  kind: scanKindSchema,
  startedAt: isoDateTimeSchema,
})
export type RunningScanDto = z.infer<typeof runningScanDtoSchema>

export const storageCategorySchema = z.enum([
  'database',
  'backups',
  'images',
  'transcode',
  'trickplay',
  'subtitles',
  'keyframes',
  'previews',
  'app',
  'logs',
])
export type StorageCategory = z.infer<typeof storageCategorySchema>

export const storageDtoSchema = z.object({
  dataDir: z.string(),
  categories: z.array(z.object({ category: storageCategorySchema, bytes: z.number().int() })),
  totalBytes: z.number().int().optional(),
  freeBytes: z.number().int().optional(),
  measuredAt: isoDateTimeSchema,
})
export type StorageDto = z.infer<typeof storageDtoSchema>

export const adminStatsDtoSchema = z.object({
  counts: z.object({
    movies: z.number().int(),
    series: z.number().int(),
    episodes: z.number().int(),
    pendingSources: z.number().int(),
    needsReview: z.number().int(),
    missingSources: z.number().int(),
  }),
  runningScans: z.array(runningScanDtoSchema),
  activePlaybackSessions: z.number().int(),
  unreadNotifications: z.number().int(),
  failedJobs: z.number().int(),
  version: z.object({ app: z.string(), runtime: z.string() }),
  updateAvailable: z.object({ version: z.string(), runtimeCompatible: z.boolean() }).optional(),
})
export type AdminStatsDto = z.infer<typeof adminStatsDtoSchema>

export const dbExportResponseSchema = z.object({
  file: z.string(),
  path: z.string(),
  sizeBytes: z.number().int(),
  createdAt: isoDateTimeSchema,
})
export type DbExportResponse = z.infer<typeof dbExportResponseSchema>
