import { z } from 'zod'

import { errorCodes } from '../errors/index.ts'
import { scanStatsSchema } from './libraries.ts'
import { notificationKindSchema, notificationSeveritySchema } from './notifications.ts'
import { updateStateSchema } from './updates.ts'

/** Server-sent events (§17.1). The payload schemas are the SSE wire contract. */

const errorSummarySchema = z.object({
  code: z.enum(errorCodes),
  message: z.string(),
})

/**
 * `discovering`: the roots are being walked, `stats.seen` grows. `processing`: the walk is over
 * (`stats.seen` is final), changes are applied, parts / subtitles / links computed, probes queued.
 */
export const scanPhaseSchema = z.enum(['discovering', 'processing'])
export type ScanPhase = z.infer<typeof scanPhaseSchema>

export const serverEventSchemas = {
  'scan.progress': z.object({
    libraryId: z.string(),
    scanRunId: z.string(),
    stats: scanStatsSchema,
    phase: scanPhaseSchema,
    /**
     * Video files the walk is expected to see, for a determinate bar (`stats.seen / total`).
     * Discovering: what the previous complete walk of the reachable roots found, absent when a
     * root was never walked (first scan: indeterminate). Processing: the files found.
     */
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
    /** Auth session the playback belongs to: the SSE layer delivers only to it. */
    sessionId: z.string(),
    reason: z.enum(['admin', 'timeout', 'ended']),
  }),
  /**
   * The catalogue changed (files ready, scans finished, identification or images done): clients
   * refetch what they show. Coalesced by the server (at most one every 2 s), no detail: every
   * profile receives it, whatever it sees.
   */
  'catalog.changed': z.object({}),
  /**
   * The updater's state changed (§16.4); `version`: the release being checked out or installed.
   * The web refetches `GET /admin/updates` on it; on `restarting` it waits for `/health`.
   */
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

/** Who may receive an event on the SSE stream (§17.1 "filtered by audience"). */
export type EventAudience = 'admin' | 'everyone' | 'owning_session'

export const serverEventAudience: Record<ServerEventType, EventAudience> = {
  'scan.progress': 'admin',
  'scan.finished': 'admin',
  // Names libraries and sources: admins only (the playback module listens on the internal bus).
  'source.ready': 'admin',
  'job.updated': 'admin',
  'notification.created': 'admin',
  'playback.session_terminated': 'owning_session',
  'update.state': 'admin',
  'catalog.changed': 'everyone',
}
