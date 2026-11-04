import { z } from 'zod'

import { isoDateTimeSchema } from './common.ts'

const semverSchema = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, {
  message: 'expected a semver version such as 1.4.0',
})

export const updateStateSchema = z.enum([
  'idle',
  'checking',
  'available',
  'downloading',
  'applying',
  'restarting',
  'failed',
])
export type UpdateState = z.infer<typeof updateStateSchema>

export const appVersionStateSchema = z.enum(['current', 'previous', 'failed', 'staged'])
export type AppVersionState = z.infer<typeof appVersionStateSchema>

export const releaseDtoSchema = z.object({
  version: semverSchema,
  publishedAt: isoDateTimeSchema,
  notes: z.string(),
  url: z.string(),
  runtimeMin: semverSchema,
  runtimeCompatible: z.boolean(),
  pullCommand: z.string().optional(),
})
export type ReleaseDto = z.infer<typeof releaseDtoSchema>

export const appVersionDtoSchema = z.object({
  version: semverSchema,
  state: appVersionStateSchema,
  installedAt: isoDateTimeSchema,
  runtimeMin: semverSchema,
  canSwitch: z.boolean(),
})
export type AppVersionDto = z.infer<typeof appVersionDtoSchema>

export const updateRunDtoSchema = z.object({
  id: z.string(),
  kind: z.enum(['update', 'rollback']),
  fromVersion: semverSchema,
  toVersion: semverSchema,
  requestedAt: isoDateTimeSchema,
  finishedAt: isoDateTimeSchema.optional(),
  outcome: z.enum(['pending', 'succeeded', 'failed', 'rolled_back']),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
})
export type UpdateRunDto = z.infer<typeof updateRunDtoSchema>

export const updatesStatusDtoSchema = z.object({
  enabled: z.boolean(),
  current: z.object({ version: z.string(), runtime: z.string() }),
  channel: z.literal('stable'),
  state: updateStateSchema,
  progress: z.number().min(0).max(100).optional(),
  lastCheckedAt: isoDateTimeSchema.optional(),
  lastCheckError: z.object({ code: z.string(), message: z.string() }).optional(),
  available: releaseDtoSchema.optional(),
  versions: z.array(appVersionDtoSchema),
  runs: z.array(updateRunDtoSchema),
})
export type UpdatesStatusDto = z.infer<typeof updatesStatusDtoSchema>

export const applyUpdateBodySchema = z.object({ version: semverSchema })
export type ApplyUpdateBody = z.infer<typeof applyUpdateBodySchema>

export const rollbackBodySchema = z.object({ version: semverSchema })
export type RollbackBody = z.infer<typeof rollbackBodySchema>

export const rollbackResponseSchema = z.object({ version: semverSchema })
export type RollbackResponse = z.infer<typeof rollbackResponseSchema>
