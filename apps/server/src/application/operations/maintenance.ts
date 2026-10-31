import { appError, err, map, ok } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import { DONE_JOB_RETENTION_MS, FAILED_JOB_RETENTION_MS } from '../../core/jobs/job.ts'
import type { JobRepository } from '../../core/jobs/ports.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import {
  DISK_LOW_THRESHOLD_BYTES,
  NEEDS_REVIEW_REMINDER_MS,
  type NeedsReviewReminderStore,
  type NotificationPurge,
} from '../../core/notifications/notification.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { AdminNotifier, ScanRunRepository } from '../../core/scanner/ports.ts'
import type { MissingSourceRepository } from '../../core/source/source.ts'
import { type DatabaseExporter, type DiskUsage, exportFileName } from '../../core/stats/stats.ts'
import type { ExportDatabase, MissingSourcesAdmin } from './types.ts'

/** §24 "Purge of missing files": a source `missing` for longer than this is purged daily. */
export const MISSING_PURGE_AFTER_MS = 30 * 24 * 60 * 60_000

// ── Missing sources (§7.5, §15 "Manquants") ──────────────────────────────────

type MissingDeps = {
  missingSources: MissingSourceRepository
  playbackSessions: PlaybackSessionTerminator
  /** §9.1: a movie or series whose deciding library loses its files is refreshed. */
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  logger: Logger
}

/** Ends the sessions on the files (§10.6: the rows go with them), then purges. */
const purgeSources = (
  { missingSources, playbackSessions, metadataContext, logger }: MissingDeps,
  sourceIds: string[],
): number => {
  if (sourceIds.length === 0) return 0
  const settle = metadataContext.filesLeaving({ sourceIds })
  playbackSessions.endWithin({ sourceIds })
  const { purged, deletedItems } = missingSources.purge(sourceIds)
  settle()
  logger.info('missing sources purged', { purged, deletedItems })
  return purged
}

/** `DELETE /admin/sources/:id` and `POST /admin/sources/purge-missing`. */
export const missingSourcesAdminFactory = (deps: MissingDeps): MissingSourcesAdmin => ({
  purge: ({ sourceId }) => {
    const state = deps.missingSources.stateOf(sourceId)
    if (state === undefined)
      return err(appError('source/not_found', 'source not found', { context: { sourceId } }))
    if (state !== 'missing')
      return err(
        appError('source/not_missing', 'only a missing source can be purged', {
          context: { sourceId, state },
        }),
      )
    purgeSources(deps, [sourceId])
    return ok()
  },
  purgeAll: ({ libraryId }) => ({
    purged: purgeSources(
      deps,
      deps.missingSources.listMissingIds(libraryId === undefined ? {} : { libraryId }),
    ),
  }),
})

/** The daily `purge_missing` (§7.5, §18): sources missing for more than 30 days. */
export const purgeExpiredMissingFactory =
  (deps: MissingDeps & { clock: Clock; maxAgeMs?: number }) => (): { purged: number } => ({
    purged: purgeSources(
      deps,
      deps.missingSources.listMissingIds({
        missingBefore: new Date(
          deps.clock.now().getTime() - (deps.maxAgeMs ?? MISSING_PURGE_AFTER_MS),
        ),
      }),
    ),
  })

// ── Job retention (§18) ──────────────────────────────────────────────────────

/**
 * Hourly `purge-jobs`: `done` jobs go 7 days after they finished, `failed` and `cancelled` ones
 * after 30 days; `queued` and `running` stay (§18 "Rules").
 */
export const purgeOldJobsFactory =
  ({
    jobRepository,
    clock,
    logger,
  }: {
    jobRepository: Pick<JobRepository, 'purgeFinished'>
    clock: Clock
    logger: Logger
  }) =>
  (): { deleted: number } => {
    const now = clock.now().getTime()
    const deleted = jobRepository.purgeFinished({
      doneBefore: new Date(now - DONE_JOB_RETENTION_MS),
      failedBefore: new Date(now - FAILED_JOB_RETENTION_MS),
    })
    if (deleted > 0) logger.info('old jobs purged', { deleted })
    return { deleted }
  }

/** Resolved notifications, and finished scan runs (each library's latest stays), kept this long. */
export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000

/** With `purge-jobs`, hourly: the other histories that only grow (§18 "Rules"). */
export const purgeOldHistoryFactory =
  ({
    notifications,
    scanRuns,
    clock,
    logger,
  }: {
    notifications: NotificationPurge
    scanRuns: Pick<ScanRunRepository, 'purgeFinishedBefore'>
    clock: Clock
    logger: Logger
  }) =>
  (): { notifications: number; scanRuns: number } => {
    const before = new Date(clock.now().getTime() - HISTORY_RETENTION_MS)
    const deleted = {
      notifications: notifications.purgeResolvedBefore(before),
      scanRuns: scanRuns.purgeFinishedBefore(before),
    }
    if (deleted.notifications + deleted.scanRuns > 0) logger.info('old history purged', deleted)
    return deleted
  }

// ── Database export (§5.4, §21) ──────────────────────────────────────────────

/** "Exporter la base": `VACUUM INTO db/backups/projo-export-<time>.db`. */
export const exportDatabaseFactory =
  ({
    exporter,
    backupsDir,
    clock,
    logger,
  }: {
    exporter: DatabaseExporter
    backupsDir: string
    clock: Clock
    logger: Logger
  }): ExportDatabase =>
  () => {
    const createdAt = clock.now()
    const file = exportFileName(createdAt)
    const path = `${backupsDir.replace(/\/+$/u, '')}/${file}`
    const result = map(exporter.exportTo(path), ({ sizeBytes }) => ({
      file,
      path,
      sizeBytes,
      createdAt,
    }))
    if (result.ok) logger.info('database exported', { file, sizeBytes: result.value.sizeBytes })
    else logger.error('database export failed', { code: result.error.code, error: result.error })
    return result
  }

// ── Periodic checks (§15 notifications) ──────────────────────────────────────

/** `cache/disk_low`: less than 2 GB free on `/data`; resolved once there is room again. */
export const checkDiskSpaceFactory =
  ({
    diskUsage,
    dataDir,
    notifier,
    thresholdBytes = DISK_LOW_THRESHOLD_BYTES,
  }: {
    diskUsage: Pick<DiskUsage, 'fileSystem'>
    dataDir: string
    notifier: AdminNotifier
    thresholdBytes?: number
  }) =>
  async (): Promise<void> => {
    const fileSystem = await diskUsage.fileSystem(dataDir)
    if (fileSystem === undefined) return
    if (fileSystem.freeBytes >= thresholdBytes) {
      notifier.resolve({ kind: 'cache/disk_low', key: 'data' })
      return
    }
    notifier.notify({
      kind: 'cache/disk_low',
      severity: 'warning',
      key: 'data',
      context: { freeBytes: fileSystem.freeBytes, totalBytes: fileSystem.totalBytes },
    })
  }

/**
 * `scan/needs_review_count`, daily while "To review" is not empty: each day's reminder
 * supersedes (resolves) the previous one; an empty queue resolves it.
 */
export const remindNeedsReviewFactory =
  ({
    countNeedsReview,
    reminders,
    notifier,
    clock,
  }: {
    countNeedsReview: () => number
    reminders: NeedsReviewReminderStore
    notifier: AdminNotifier
    clock: Clock
  }) =>
  (): void => {
    const count = countNeedsReview()
    if (count === 0) {
      notifier.resolve({ kind: 'scan/needs_review_count', key: 'needs_review' })
      return
    }
    const now = clock.now()
    const last = reminders.read()
    if (last !== undefined && now.getTime() - last.getTime() < NEEDS_REVIEW_REMINDER_MS) return
    notifier.resolve({ kind: 'scan/needs_review_count', key: 'needs_review' })
    notifier.notify({
      kind: 'scan/needs_review_count',
      severity: 'info',
      key: 'needs_review',
      context: { count },
    })
    reminders.write(now)
  }
