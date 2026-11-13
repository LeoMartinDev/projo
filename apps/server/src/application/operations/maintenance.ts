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
import type { ScanRunRepository } from '../../core/scanner/ports.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { MissingSourceRepository } from '../../core/source/source.ts'
import { type DatabaseExporter, type DiskUsage, exportFileName } from '../../core/stats/stats.ts'
import type { ExportDatabase, MissingSourcesAdmin } from './types.ts'

export const MISSING_PURGE_AFTER_MS = 30 * 24 * 60 * 60_000

type MissingDeps = {
  missingSources: MissingSourceRepository
  playbackSessions: PlaybackSessionTerminator
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  logger: Logger
}

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

export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000

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
