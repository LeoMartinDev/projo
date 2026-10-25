import { z } from 'zod'

import { isoDateTimeSchema, pageSchema, paginationQuerySchema } from './common.ts'
import { reviewReasonSchema } from './metadata.ts'
import { editionIdSchema, sourceVersionDtoSchema } from './versions.ts'

/** Schemas for `/api/v1/admin/libraries` and `/api/v1/admin/sources` (§17.2 Admin librairies, sources). */

export const libraryHintSchema = z.enum(['auto', 'movies', 'series'])
export type LibraryHint = z.infer<typeof libraryHintSchema>

export const libraryRootStateSchema = z.enum(['ok', 'unreachable'])
export type LibraryRootState = z.infer<typeof libraryRootStateSchema>

/**
 * Why the §7.5 guard found a root `unreachable`: the path does not exist (`not_found`), is not a
 * directory, cannot be read (`io_error`), or used to hold videos and is now empty (`empty`, an
 * unmounted mount point) or holds no video anymore (`no_media`). Worded by the web.
 */
export const rootErrorReasons = [
  'not_found',
  'not_directory',
  'io_error',
  'empty',
  'no_media',
] as const
export const rootErrorReasonSchema = z.enum(rootErrorReasons)
export type RootErrorReason = z.infer<typeof rootErrorReasonSchema>

/** What triggered a scan (§7.4). `initial`: the first scan of a library, right after its creation. */
export const scanKindSchema = z.enum([
  'watch',
  'periodic',
  'manual_quick',
  'manual_full',
  'startup',
  'initial',
])
export type ScanKind = z.infer<typeof scanKindSchema>

export const sourceStateSchema = z.enum(['pending', 'ready', 'missing', 'rejected'])
export type SourceState = z.infer<typeof sourceStateSchema>

export const pendingReasonSchema = z.enum(['growing', 'probe_failed', 'decode_failed', 'too_small'])
export type PendingReason = z.infer<typeof pendingReasonSchema>

export const classificationSchema = z.enum(['movie', 'episode', 'unknown'])
export const matchStateSchema = z.enum(['unmatched', 'matched', 'manual', 'needs_review'])

// ── Libraries ─────────────────────────────────────────────────────────────────

/** Absolute container path (§7.1). Normalized server-side (trailing slash dropped). */
export const rootPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.startsWith('/'), { message: 'root path must be absolute' })
  .refine((value) => !value.includes('\0'), { message: 'root path must not contain NUL' })

const settingsShape = {
  hint: libraryHintSchema,
  scanIntervalMinutes: z.number().int().min(1).max(10_080),
  watchEnabled: z.boolean(),
  quietPeriodSeconds: z.number().int().min(0).max(86_400),
  detectSegments: z.boolean(),
  preExtractSubtitles: z.boolean(),
  trickplayEnabled: z.boolean(),
  /** BCP 47 (`fr-FR`); absent = server setting. */
  metadataLanguage: z.string().min(2).max(16),
  /** ISO 3166-1 alpha-2. */
  ratingCountry: z
    .string()
    .regex(/^[A-Za-z]{2}$/u)
    .transform((value) => value.toUpperCase()),
}

export const createLibraryBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  roots: z.array(rootPathSchema).min(1).max(32),
  hint: settingsShape.hint.default('auto'),
  scanIntervalMinutes: settingsShape.scanIntervalMinutes.default(15),
  watchEnabled: settingsShape.watchEnabled.default(true),
  quietPeriodSeconds: settingsShape.quietPeriodSeconds.default(120),
  detectSegments: settingsShape.detectSegments.default(true),
  preExtractSubtitles: settingsShape.preExtractSubtitles.default(false),
  trickplayEnabled: settingsShape.trickplayEnabled.default(true),
  metadataLanguage: settingsShape.metadataLanguage.optional(),
  ratingCountry: settingsShape.ratingCountry.default('FR'),
})
export type CreateLibraryBody = z.infer<typeof createLibraryBodySchema>

/**
 * Every field optional. `roots` replaces the whole set: kept paths keep their sources, removed
 * roots lose theirs. `metadataLanguage: ""` clears it (back to the server setting).
 */
export const updateLibraryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    roots: z.array(rootPathSchema).min(1).max(32),
    hint: settingsShape.hint,
    scanIntervalMinutes: settingsShape.scanIntervalMinutes,
    watchEnabled: settingsShape.watchEnabled,
    quietPeriodSeconds: settingsShape.quietPeriodSeconds,
    detectSegments: settingsShape.detectSegments,
    preExtractSubtitles: settingsShape.preExtractSubtitles,
    trickplayEnabled: settingsShape.trickplayEnabled,
    metadataLanguage: z.union([settingsShape.metadataLanguage, z.literal('')]),
    ratingCountry: settingsShape.ratingCountry,
  })
  .partial()
export type UpdateLibraryBody = z.infer<typeof updateLibraryBodySchema>

export const libraryRootDtoSchema = z.object({
  id: z.string(),
  path: z.string(),
  state: libraryRootStateSchema,
  lastScanAt: isoDateTimeSchema.optional(),
  /** Video files found by the last complete walk of this root. */
  lastFileCount: z.number().int(),
  /** Set while `state` is `unreachable`. */
  lastError: rootErrorReasonSchema.optional(),
})
export type LibraryRootDto = z.infer<typeof libraryRootDtoSchema>

export const sourceCountsSchema = z.object({
  pending: z.number().int(),
  ready: z.number().int(),
  missing: z.number().int(),
  rejected: z.number().int(),
})
export type SourceCounts = z.infer<typeof sourceCountsSchema>

/**
 * Where the pending sources stand past discovery (§7.2–7.3), sources of unreachable roots left
 * out. `waiting` + `verifying` are on their way to `ready`; `failed` will not get there on their
 * own (only a change of the file, a scan or a re-check moves them).
 */
export const libraryAnalysisSchema = z.object({
  /** `growing`, quiet period running (§7.3 step 3). */
  waiting: z.number().int(),
  /** Stable: probe and sample decodes queued or running (§7.3 step 4). */
  verifying: z.number().int(),
  /** `probe_failed`, `decode_failed`, `too_small`. */
  failed: z.number().int(),
  /** Earliest end of a running quiet period (absent when nothing waits). */
  nextReadyAt: isoDateTimeSchema.optional(),
})
export type LibraryAnalysis = z.infer<typeof libraryAnalysisSchema>

/**
 * Stats of a scan run (`scan_runs.stats`), also carried by the SSE `scan.progress` and
 * `scan.finished` events.
 * - `discovered`: new sources created by this run
 * - `pending`: sources put in quarantine by this run (new or changed on disk)
 * - `ready`: sources back to `ready` during this run (reappeared unchanged)
 * - `missing`: sources marked `missing`
 * - `errors`: unreachable roots and unreadable entries
 * - `seen`: video files walked; `moved`: sources whose path changed (§7.6)
 */
export const scanStatsSchema = z.object({
  discovered: z.number().int(),
  pending: z.number().int(),
  ready: z.number().int(),
  missing: z.number().int(),
  errors: z.number().int(),
  seen: z.number().int().default(0),
  moved: z.number().int().default(0),
})
export type ScanStats = z.infer<typeof scanStatsSchema>

export const scanRunDtoSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  kind: scanKindSchema,
  startedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.optional(),
  stats: scanStatsSchema,
  /** Error code when the run (or one of its roots) failed, e.g. `library/root_unreachable`. */
  error: z.string().optional(),
})
export type ScanRunDto = z.infer<typeof scanRunDtoSchema>

export const libraryDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  hint: libraryHintSchema,
  scanIntervalMinutes: z.number().int(),
  watchEnabled: z.boolean(),
  quietPeriodSeconds: z.number().int(),
  detectSegments: z.boolean(),
  preExtractSubtitles: z.boolean(),
  trickplayEnabled: z.boolean(),
  metadataLanguage: z.string().optional(),
  ratingCountry: z.string(),
  createdAt: isoDateTimeSchema,
  roots: z.array(libraryRootDtoSchema),
  sourceCounts: sourceCountsSchema,
  analysis: libraryAnalysisSchema,
  lastScan: scanRunDtoSchema.optional(),
})
export type LibraryDto = z.infer<typeof libraryDtoSchema>

export const libraryListResponseSchema = z.object({ items: z.array(libraryDtoSchema) })
export type LibraryListResponse = z.infer<typeof libraryListResponseSchema>

/** `POST /admin/libraries/:id/scan`: `quick` = incremental, `full` = re-read and re-probe everything (§7.4). */
export const scanLibraryBodySchema = z.object({
  mode: z.enum(['quick', 'full']).default('quick'),
})
export type ScanLibraryBody = z.infer<typeof scanLibraryBodySchema>

export const scanRequestedResponseSchema = z.object({
  jobId: z.string(),
  /** True when an already queued scan absorbed the request (§7.4 coalescing). */
  deduplicated: z.boolean(),
})
export type ScanRequestedResponse = z.infer<typeof scanRequestedResponseSchema>

export const scanRunsQuerySchema = paginationQuerySchema
export const scanRunsPageSchema = pageSchema(scanRunDtoSchema)
export type ScanRunsPage = z.infer<typeof scanRunsPageSchema>

// ── Sources (admin) ──────────────────────────────────────────────────────────

export const sourcesQuerySchema = paginationQuerySchema.extend({
  libraryId: z.string().min(1).optional(),
  state: sourceStateSchema.optional(),
  /** `needs_review` = the "To review" queue (§7.8). */
  matchState: matchStateSchema.optional(),
})
export type SourcesQuery = z.infer<typeof sourcesQuerySchema>

/** What the parser understood of the path (§8), shown in "To review" (§15). */
export const parsedNameDtoSchema = z.object({
  title: z.string().optional(),
  year: z.number().int().optional(),
  series: z.string().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  episodeEnd: z.number().int().optional(),
  episodeTitle: z.string().optional(),
  absoluteEpisode: z.number().int().optional(),
  airDate: z.string().optional(),
  /** §8.1 edition: a known id, or the text of a `{edition-…}` tag. */
  edition: editionIdSchema.optional(),
  editionName: z.string().optional(),
  ids: z
    .object({
      tmdb: z.number().int().optional(),
      imdb: z.string().optional(),
      tvdb: z.number().int().optional(),
    })
    .optional(),
})
export type ParsedNameDto = z.infer<typeof parsedNameDtoSchema>

/** An item a source is linked to, named for the admin ("attached item", §15 "Missing"). */
export const sourceItemDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['movie', 'series', 'season', 'episode']),
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title: z.string().optional(),
  /** Episodes: their series. */
  seriesTitle: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
})
export type SourceItemDto = z.infer<typeof sourceItemDtoSchema>

export const sourceDtoSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  rootId: z.string(),
  /** Absolute path (root + relative path). */
  path: z.string(),
  relativePath: z.string(),
  state: sourceStateSchema,
  pendingReason: pendingReasonSchema.optional(),
  sizeBytes: z.number().int(),
  discoveredAt: isoDateTimeSchema,
  pendingSince: isoDateTimeSchema.optional(),
  /**
   * Since when size and mtime have not moved (§7.3 quiet period): "last change" of
   * "Fichiers en attente" (§15). Set on `pending` sources.
   */
  unchangedSince: isoDateTimeSchema.optional(),
  stableSince: isoDateTimeSchema.optional(),
  readyAt: isoDateTimeSchema.optional(),
  missingSince: isoDateTimeSchema.optional(),
  classification: classificationSchema,
  /** Title computed by the parser (§8), before any matching. */
  displayTitle: z.string(),
  matchState: matchStateSchema,
  /** Set while `matchState` is `needs_review` (§7.8). */
  reviewReason: reviewReasonSchema.optional(),
  parsed: parsedNameDtoSchema,
  /** §7.7, from the probe (absent until probed) and the parsed edition. */
  version: sourceVersionDtoSchema,
  durationMs: z.number().int().optional(),
  itemIds: z.array(z.string()),
  /** The items of `itemIds` with their titles, in the same order. */
  items: z.array(sourceItemDtoSchema),
})
export type SourceDto = z.infer<typeof sourceDtoSchema>

/** `total`: every source matching the filters, all pages (the "To review" count, §15). */
export const sourcesPageSchema = pageSchema(sourceDtoSchema).extend({ total: z.number().int() })
export type SourcesPage = z.infer<typeof sourcesPageSchema>

// ── Missing sources (§7.5, §15 "Manquants") ──────────────────────────────────
//
// `DELETE /admin/sources/:id`: purges one `missing` source now (204; 409 `source/not_missing`
// otherwise), as the daily `purge_missing` does after 30 days: its links, the items left without
// source or child, their derived files; `manual_matches` keeps the correction (§9.2).

/** `POST /admin/sources/purge-missing`: every `missing` source, of one library or of all. */
export const purgeMissingBodySchema = z.object({ libraryId: z.string().min(1).optional() })
export type PurgeMissingBody = z.infer<typeof purgeMissingBodySchema>

export const purgeMissingResponseSchema = z.object({ purged: z.number().int() })
export type PurgeMissingResponse = z.infer<typeof purgeMissingResponseSchema>
