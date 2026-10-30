import { z } from 'zod'

import { isoDateTimeSchema } from './common.ts'
import { scanKindSchema } from './libraries.ts'

/**
 * §15 "Dashboard" and "Server", §17.2: `GET /admin/stats`, `POST /admin/db/export`.
 */

/**
 * A scan running when the stats were read; its progress then arrives by `scan.progress` /
 * `scan.finished` (§17.1).
 */
export const runningScanDtoSchema = z.object({
  libraryId: z.string(),
  libraryName: z.string(),
  scanRunId: z.string(),
  kind: scanKindSchema,
  startedAt: isoDateTimeSchema,
})
export type RunningScanDto = z.infer<typeof runningScanDtoSchema>

/**
 * Space used under `/data` (§15 "Server": "space used per category"), one line per folder of
 * the §5.4 layout: `database` (`db/projo.db` + WAL), `backups` (`db/backups/`), `images`, the
 * caches, `app` (installed versions), `logs`.
 */
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

/**
 * `GET /admin/storage` (§15 "Server"). Measured at most every 5 minutes (walking the caches is
 * not free): `measuredAt` says when. `totalBytes` / `freeBytes`: the file system holding `/data`,
 * when the platform tells.
 */
export const storageDtoSchema = z.object({
  dataDir: z.string(),
  categories: z.array(z.object({ category: storageCategorySchema, bytes: z.number().int() })),
  totalBytes: z.number().int().optional(),
  freeBytes: z.number().int().optional(),
  measuredAt: isoDateTimeSchema,
})
export type StorageDto = z.infer<typeof storageDtoSchema>

/** `GET /admin/stats`: the dashboard (§15), database reads only (storage has its own route). */
export const adminStatsDtoSchema = z.object({
  /**
   * Visible items (§6.3) and sources by state: `pendingSources` (`pending`), `needsReview`
   * (`match_state = needs_review`, the "To review" count), `missingSources` (`missing`).
   */
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
  /** Jobs `failed` for good in the last 24 h (link to the "Jobs" screen). */
  failedJobs: z.number().int(),
  version: z.object({ app: z.string(), runtime: z.string() }),
  /** The newer release known from the last `check_updates` (§16.4). */
  updateAvailable: z.object({ version: z.string(), runtimeCompatible: z.boolean() }).optional(),
})
export type AdminStatsDto = z.infer<typeof adminStatsDtoSchema>

/**
 * `POST /admin/db/export` (§5.4 "Exporter la base"): `VACUUM INTO db/backups/<file>`, synchronous.
 * 201 with the file written (absolute `path`: admin only). Error: 500 `db/export_failed`.
 */
export const dbExportResponseSchema = z.object({
  /** `projo-export-<YYYYMMDD-HHmmss>.db`. */
  file: z.string(),
  path: z.string(),
  sizeBytes: z.number().int(),
  createdAt: isoDateTimeSchema,
})
export type DbExportResponse = z.infer<typeof dbExportResponseSchema>
