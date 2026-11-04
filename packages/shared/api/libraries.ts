import { z } from 'zod'

import { isoDateTimeSchema, pageSchema, paginationQuerySchema } from './common.ts'
import { reviewReasonSchema } from './metadata.ts'
import { editionIdSchema, sourceVersionDtoSchema } from './versions.ts'

export const libraryHintSchema = z.enum(['auto', 'movies', 'series'])
export type LibraryHint = z.infer<typeof libraryHintSchema>

export const libraryRootStateSchema = z.enum(['ok', 'unreachable'])
export type LibraryRootState = z.infer<typeof libraryRootStateSchema>

export const rootErrorReasons = [
  'not_found',
  'not_directory',
  'io_error',
  'empty',
  'no_media',
] as const
export const rootErrorReasonSchema = z.enum(rootErrorReasons)
export type RootErrorReason = z.infer<typeof rootErrorReasonSchema>

export const scanKindSchema = z.enum([
  'watch',
  'periodic',
  'manual_quick',
  'manual_full',
  'startup',
  'initial',
  'rules_update',
])
export type ScanKind = z.infer<typeof scanKindSchema>

export const sourceStateSchema = z.enum(['pending', 'ready', 'missing', 'rejected'])
export type SourceState = z.infer<typeof sourceStateSchema>

export const pendingReasonSchema = z.enum(['growing', 'probe_failed', 'decode_failed', 'too_small'])
export type PendingReason = z.infer<typeof pendingReasonSchema>

export const classificationSchema = z.enum(['movie', 'episode', 'unknown'])
export const matchStateSchema = z.enum(['unmatched', 'matched', 'manual', 'needs_review'])

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
  metadataLanguage: z.string().min(2).max(16),
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
  lastFileCount: z.number().int(),
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

export const libraryAnalysisSchema = z.object({
  waiting: z.number().int(),
  verifying: z.number().int(),
  failed: z.number().int(),
  nextReadyAt: isoDateTimeSchema.optional(),
})
export type LibraryAnalysis = z.infer<typeof libraryAnalysisSchema>

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

export const scanLibraryBodySchema = z.object({
  mode: z.enum(['quick', 'full']).default('quick'),
})
export type ScanLibraryBody = z.infer<typeof scanLibraryBodySchema>

export const scanRequestedResponseSchema = z.object({
  jobId: z.string(),
  deduplicated: z.boolean(),
})
export type ScanRequestedResponse = z.infer<typeof scanRequestedResponseSchema>

export const scanRunsQuerySchema = paginationQuerySchema
export const scanRunsPageSchema = pageSchema(scanRunDtoSchema)
export type ScanRunsPage = z.infer<typeof scanRunsPageSchema>

export const sourcesQuerySchema = paginationQuerySchema.extend({
  libraryId: z.string().min(1).optional(),
  state: sourceStateSchema.optional(),
  matchState: matchStateSchema.optional(),
})
export type SourcesQuery = z.infer<typeof sourcesQuerySchema>

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

export const sourceItemDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['movie', 'series', 'season', 'episode']),
  title: z.string().optional(),
  seriesTitle: z.string().optional(),
  seasonNumber: z.number().int().optional(),
  episodeNumber: z.number().int().optional(),
})
export type SourceItemDto = z.infer<typeof sourceItemDtoSchema>

export const sourceDtoSchema = z.object({
  id: z.string(),
  libraryId: z.string(),
  rootId: z.string(),
  path: z.string(),
  relativePath: z.string(),
  state: sourceStateSchema,
  pendingReason: pendingReasonSchema.optional(),
  sizeBytes: z.number().int(),
  discoveredAt: isoDateTimeSchema,
  pendingSince: isoDateTimeSchema.optional(),
  unchangedSince: isoDateTimeSchema.optional(),
  stableSince: isoDateTimeSchema.optional(),
  readyAt: isoDateTimeSchema.optional(),
  missingSince: isoDateTimeSchema.optional(),
  classification: classificationSchema,
  displayTitle: z.string(),
  matchState: matchStateSchema,
  reviewReason: reviewReasonSchema.optional(),
  parsed: parsedNameDtoSchema,
  version: sourceVersionDtoSchema,
  durationMs: z.number().int().optional(),
  itemIds: z.array(z.string()),
  items: z.array(sourceItemDtoSchema),
})
export type SourceDto = z.infer<typeof sourceDtoSchema>

export const sourcesPageSchema = pageSchema(sourceDtoSchema).extend({ total: z.number().int() })
export type SourcesPage = z.infer<typeof sourcesPageSchema>

export const purgeMissingBodySchema = z.object({ libraryId: z.string().min(1).optional() })
export type PurgeMissingBody = z.infer<typeof purgeMissingBodySchema>

export const purgeMissingResponseSchema = z.object({ purged: z.number().int() })
export type PurgeMissingResponse = z.infer<typeof purgeMissingResponseSchema>
