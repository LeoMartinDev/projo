import type { AppError, Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type { JobListQuery, JobTargetItem, JobTargetRef } from '../../core/jobs/ports.ts'
import type { Notification, NotificationStatus } from '../../core/notifications/notification.ts'
import type { PlaybackSettings } from '../../core/settings/settings.ts'
import type { CatalogCounts, RunningScan, StorageUsage } from '../../core/stats/stats.ts'

/**
 * The use cases of the operations admin (§15: dashboard, jobs, notifications, missing files,
 * "Playback" and "Server" settings, database export). Built by
 * `entrypoints/modules/operations.ts`.
 */

// ── Jobs ─────────────────────────────────────────────────────────────────────

/** "Cible" of a job (§15), read from its type and payload; unnamed when it no longer exists. */
export type JobTarget = JobTargetRef & { label?: string; item?: JobTargetItem }

export type JobView = Job & { target?: JobTarget }

export type JobsAdmin = {
  list: (query: JobListQuery) => { items: JobView[]; nextCursor?: string }
  retry: (input: { id: string }) => Result<JobView, AppError<'job/not_found' | 'job/not_retryable'>>
  /** Through the runner (aborts a running job). */
  cancel: (input: {
    id: string
  }) => Result<JobView, AppError<'job/not_found' | 'job/not_cancellable'>>
}

// ── Notifications ────────────────────────────────────────────────────────────

export type NotificationsAdmin = {
  list: (input: { status?: NotificationStatus; cursor?: string; limit: number }) => {
    items: Notification[]
    nextCursor?: string
    unreadCount: number
  }
  markRead: (input: { id: string }) => Result<Notification, AppError<'notification/not_found'>>
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export type AdminStats = {
  counts: CatalogCounts
  runningScans: RunningScan[]
  activePlaybackSessions: number
  unreadNotifications: number
  failedJobs: number
  version: { app: string; runtime: string }
  updateAvailable?: { version: string; runtimeCompatible: boolean }
}

/** `GET /admin/stats`. */
export type GetAdminStats = () => AdminStats

/** `GET /admin/storage`: walks `/data`, kept off the dashboard's request. */
export type GetStorage = () => Promise<StorageUsage & { dataDir: string }>

/** `POST /admin/db/export`. */
export type ExportDatabase = () => Result<
  { file: string; path: string; sizeBytes: number; createdAt: Date },
  AppError<'db/export_failed'>
>

// ── Missing sources (§7.5) ───────────────────────────────────────────────────

/**
 * `DELETE /admin/sources/:id` and `POST /admin/sources/purge-missing`; also run by the daily
 * `purge_missing` job (sources `missing` for more than 30 days, §24). Ends the playback sessions
 * on what goes (§10.6).
 */
export type MissingSourcesAdmin = {
  purge: (input: {
    sourceId: string
  }) => Result<void, AppError<'source/not_found' | 'source/not_missing'>>
  purgeAll: (input: { libraryId?: string }) => { purged: number }
}

// ── Settings: "Playback" and "Server" (§15) ──────────────────────────────────

export type PlaybackSettingsAdmin = {
  get: () => PlaybackSettings
  update: (input: Partial<PlaybackSettings>) => PlaybackSettings
}

export type ServerSettingsView = {
  name: string
  port: number
  trustProxy: boolean
  dataDir: string
}

export type ServerSettingsAdmin = {
  get: () => ServerSettingsView
  update: (input: { name?: string }) => ServerSettingsView
}
