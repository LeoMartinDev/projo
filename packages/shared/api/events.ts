import { z } from 'zod'

import { errorCodes } from '../errors/index.ts'
import { scanStatsSchema } from './libraries.ts'
import { notificationKindSchema, notificationSeveritySchema } from './notifications.ts'
import { updateStateSchema } from './updates.ts'

const errorSummarySchema = z.object({
  code: z.enum(errorCodes),
  message: z.string(),
})

export const scanPhaseSchema = z.enum(['discovering', 'processing'])
export type ScanPhase = z.infer<typeof scanPhaseSchema>

export const serverEventSchemas = {
  'scan.progress': z.object({
    libraryId: z.string(),
    scanRunId: z.string(),
    stats: scanStatsSchema,
    phase: scanPhaseSchema,
    total: z.number().int().optional(),
  }),
  'scan.finished': z.object({
    libraryId: z.string(),
    scanRunId: z.string(),
    stats: scanStatsSchema,
    error: errorSummarySchema.optional(),
  }),
  'source.ready': z.object({
    sourceId: z.string(),
    libraryId: z.string(),
  }),
  'job.updated': z.object({
    jobId: z.string(),
    type: z.string(),
    state: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
    attempts: z.number().int(),
    progress: z.number().min(0).max(100).optional(),
    error: errorSummarySchema.optional(),
  }),
  'notification.created': z.object({
    notificationId: z.string(),
    kind: notificationKindSchema,
    severity: notificationSeveritySchema,
    titleKey: z.string(),
  }),
  'playback.session_terminated': z.object({
    playbackSessionId: z.string(),
    sessionId: z.string(),
    reason: z.enum(['admin', 'timeout', 'ended']),
  }),
  'pairing.claimed': z.object({
    pairingId: z.string(),
    sessionId: z.string(),
    deviceSessionId: z.string(),
    deviceName: z.string(),
  }),
  'catalog.changed': z.object({}),
  'update.state': z.object({
    state: updateStateSchema,
    version: z.string().optional(),
    progress: z.number().min(0).max(100).optional(),
  }),
} as const

export type ServerEventType = keyof typeof serverEventSchemas
export type ServerEventPayloads = {
  [K in ServerEventType]: z.infer<(typeof serverEventSchemas)[K]>
}
export type ServerEvent = {
  [K in ServerEventType]: { type: K; payload: ServerEventPayloads[K] }
}[ServerEventType]

export const serverEventTypes = Object.keys(serverEventSchemas) as ServerEventType[]

export type EventAudience = 'admin' | 'everyone' | 'owning_session'

export const serverEventAudience: Record<ServerEventType, EventAudience> = {
  'scan.progress': 'admin',
  'scan.finished': 'admin',
  'source.ready': 'admin',
  'job.updated': 'admin',
  'notification.created': 'admin',
  'playback.session_terminated': 'owning_session',
  'pairing.claimed': 'owning_session',
  'update.state': 'admin',
  'catalog.changed': 'everyone',
}
