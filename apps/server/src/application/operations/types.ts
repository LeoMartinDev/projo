import type { AppError, Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type { JobListQuery, JobTargetItem, JobTargetRef } from '../../core/jobs/ports.ts'
import type { Notification, NotificationStatus } from '../../core/notifications/notification.ts'
import type { PlaybackSettings } from '../../core/settings/settings.ts'
import type { CatalogCounts, RunningScan, StorageUsage } from '../../core/stats/stats.ts'

export type JobTarget = JobTargetRef & { label?: string; item?: JobTargetItem }

export type JobView = Job & { target?: JobTarget }

export type JobsAdmin = {
  list: (query: JobListQuery) => { items: JobView[]; nextCursor?: string }
  retry: (input: { id: string }) => Result<JobView, AppError<'job/not_found' | 'job/not_retryable'>>
  cancel: (input: {
    id: string
  }) => Result<JobView, AppError<'job/not_found' | 'job/not_cancellable'>>
}

export type NotificationsAdmin = {
  list: (input: { status?: NotificationStatus; cursor?: string; limit: number }) => {
    items: Notification[]
    nextCursor?: string
    unreadCount: number
  }
  markRead: (input: { id: string }) => Result<Notification, AppError<'notification/not_found'>>
}

export type AdminStats = {
  counts: CatalogCounts
  runningScans: RunningScan[]
  activePlaybackSessions: number
  unreadNotifications: number
  failedJobs: number
  version: { app: string; runtime: string }
  updateAvailable?: { version: string; runtimeCompatible: boolean }
}

export type GetAdminStats = () => AdminStats

export type GetStorage = () => Promise<StorageUsage & { dataDir: string }>

export type ExportDatabase = () => Result<
  { file: string; path: string; sizeBytes: number; createdAt: Date },
  AppError<'db/export_failed'>
>

export type MissingSourcesAdmin = {
  purge: (input: {
    sourceId: string
  }) => Result<void, AppError<'source/not_found' | 'source/not_missing'>>
  purgeAll: (input: { libraryId?: string }) => { purged: number }
}

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
