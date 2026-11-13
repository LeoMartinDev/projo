import { z } from 'zod'

import { ok } from '@projo/shared'

import { cancelJobFactory } from '../../application/operations/cancel-job.ts'
import { checkDiskSpaceFactory } from '../../application/operations/check-disk-space.ts'
import { exportDatabaseFactory } from '../../application/operations/export-database.ts'
import { getAdminStatsFactory } from '../../application/operations/get-admin-stats.ts'
import { getPlaybackSettingsFactory } from '../../application/operations/get-playback-settings.ts'
import { getServerSettingsFactory } from '../../application/operations/get-server-settings.ts'
import { listJobsFactory } from '../../application/operations/list-jobs.ts'
import { listNotificationsFactory } from '../../application/operations/list-notifications.ts'
import { markNotificationReadFactory } from '../../application/operations/mark-notification-read.ts'
import { measureStorageFactory } from '../../application/operations/measure-storage.ts'
import { purgeAllMissingSourcesFactory } from '../../application/operations/purge-all-missing-sources.ts'
import { purgeExpiredMissingFactory } from '../../application/operations/purge-expired-missing.ts'
import { purgeMissingSourceFactory } from '../../application/operations/purge-missing-source.ts'
import { purgeOldHistoryFactory } from '../../application/operations/purge-old-history.ts'
import { purgeOldJobsFactory } from '../../application/operations/purge-old-jobs.ts'
import { remindNeedsReviewFactory } from '../../application/operations/remind-needs-review.ts'
import { retryJobFactory } from '../../application/operations/retry-job.ts'
import { updatePlaybackSettingsFactory } from '../../application/operations/update-playback-settings.ts'
import { updateServerSettingsFactory } from '../../application/operations/update-server-settings.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { DiskUsage } from '../../core/stats/stats.ts'
import { createNodeDiskUsage } from '../../infrastructure/fs/disk-usage.ts'
import { createSqliteDatabaseExporter } from '../../infrastructure/sqlite/database-exporter.ts'
import { createSqliteJobAdminRepository } from '../../infrastructure/sqlite/job-admin-repository.ts'
import { createSqliteJobTargetLabels } from '../../infrastructure/sqlite/job-target-labels.ts'
import { createSqliteMissingSourceRepository } from '../../infrastructure/sqlite/missing-source-repository.ts'
import { createSqliteNotificationRepository } from '../../infrastructure/sqlite/notification-repository.ts'
import {
  createSqlitePlaybackSettings,
  createSqlitePlaybackSettingsWriter,
} from '../../infrastructure/sqlite/playback-settings.ts'
import {
  createSqliteNeedsReviewReminderStore,
  createSqliteServerNameStore,
} from '../../infrastructure/sqlite/settings-values.ts'
import { createSqliteScanRunRepository } from '../../infrastructure/sqlite/scan-run-repository.ts'
import { createSqliteStatsQueries } from '../../infrastructure/sqlite/stats-queries.ts'
import { createSqliteUpdateCheckStore } from '../../infrastructure/sqlite/update-check-store.ts'
import { adminJobsRoutes } from '../http/routes/admin-jobs.ts'
import { adminNotificationsRoutes } from '../http/routes/admin-notifications.ts'
import { adminMissingSourcesRoutes } from '../http/routes/admin-sources.ts'
import { adminSystemRoutes } from '../http/routes/admin-system.ts'
import { defineJobHandlers } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const minute = 60_000
const hour = 60 * minute
const day = 24 * 60 * minute

/** The "Playback" and "Server" sections of the admin settings (§15), served by `settings`. */
const buildOperationsSettings = ({ db, config, clock }: Platform, logger: Logger) => {
  const reader = createSqlitePlaybackSettings({ db })
  const store = createSqliteServerNameStore({ db })
  const environment = {
    port: config.port,
    trustProxy: config.trustProxy,
    dataDir: config.dataDir,
  }
  return {
    playback: {
      get: getPlaybackSettingsFactory({ reader }),
      update: updatePlaybackSettingsFactory({
        reader,
        writer: createSqlitePlaybackSettingsWriter({ db }),
        clock,
        logger,
      }),
    },
    server: {
      get: getServerSettingsFactory({ store, environment }),
      update: updateServerSettingsFactory({ store, environment, clock }),
    },
  }
}

export type OperationsModuleDeps = {
  playbackSessions: PlaybackSessionTerminator
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  diskUsage?: DiskUsage
}

export const buildOperationsModule = (platform: Platform, deps: OperationsModuleDeps) => {
  const {
    db,
    clock,
    eventBus,
    notifier,
    jobQueue,
    jobRepository,
    jobControl,
    logger,
    paths,
    version,
    runtime,
  } = platform
  const log = logger.child({ module: 'operations' })
  const diskUsage = deps.diskUsage ?? createNodeDiskUsage()
  const notificationRepository = createSqliteNotificationRepository({ db })
  const jobAdminRepository = createSqliteJobAdminRepository({ db })
  const statsQueries = createSqliteStatsQueries({ db })
  const labels = createSqliteJobTargetLabels({ db })
  const measureStorage = measureStorageFactory({ diskUsage, paths, clock })
  const missingDeps = {
    missingSources: createSqliteMissingSourceRepository({ db }),
    playbackSessions: deps.playbackSessions,
    metadataContext: deps.metadataContext,
    logger: log,
  }
  const purgeExpiredMissing = purgeExpiredMissingFactory({ ...missingDeps, clock })
  const checkDiskSpace = checkDiskSpaceFactory({
    diskUsage,
    dataDir: paths.root,
    notifier,
  })
  const purgeOldJobs = purgeOldJobsFactory({ jobRepository, clock, logger: log })
  const purgeOldHistory = purgeOldHistoryFactory({
    notifications: notificationRepository,
    scanRuns: createSqliteScanRunRepository({ db }),
    clock,
    logger: log,
  })
  const remindNeedsReview = remindNeedsReviewFactory({
    countNeedsReview: () => statsQueries.counts().needsReview,
    reminders: createSqliteNeedsReviewReminderStore({ db }),
    notifier,
    clock,
  })

  const scheduledTasks: ScheduledTask[] = [
    {
      name: 'purge-missing',
      intervalMs: day,
      initialDelayMs: 15 * minute,
      run: () => {
        jobQueue.enqueue({ type: 'purge_missing', payload: {}, dedupeKey: 'purge_missing' })
      },
    },
    {
      name: 'purge-jobs',
      intervalMs: hour,
      initialDelayMs: 5 * minute,
      run: () => {
        purgeOldJobs()
        purgeOldHistory()
      },
    },
    {
      name: 'operations-checks',
      intervalMs: 15 * minute,
      initialDelayMs: minute,
      run: async () => {
        await checkDiskSpace()
        remindNeedsReview()
      },
    },
  ]

  return defineModule({
    exposes: {
      settings: buildOperationsSettings(platform, log),
      routes: {
        jobs: adminJobsRoutes({
          listJobs: listJobsFactory({ jobAdminRepository, labels }),
          retryJob: retryJobFactory({
            jobAdminRepository,
            jobRepository,
            labels,
            jobControl,
            clock,
            eventBus,
            logger: log,
          }),
          cancelJob: cancelJobFactory({ jobRepository, labels, jobControl, logger: log }),
        }),
        notifications: adminNotificationsRoutes({
          listNotifications: listNotificationsFactory({ notificationRepository }),
          markNotificationRead: markNotificationReadFactory({ notificationRepository, clock }),
        }),
        system: adminSystemRoutes({
          getStats: getAdminStatsFactory({
            statsQueries,
            notificationRepository,
            jobAdminRepository,
            checkStore: createSqliteUpdateCheckStore({ db }),
            version: { app: version, runtime },
            clock,
          }),
          getStorage: async () => ({ ...(await measureStorage()), dataDir: paths.root }),
          exportDatabase: exportDatabaseFactory({
            exporter: createSqliteDatabaseExporter({ db }),
            backupsDir: paths.db.backups,
            clock,
            logger: log,
          }),
        }),
        missingSources: adminMissingSourcesRoutes({
          purgeMissingSource: purgeMissingSourceFactory(missingDeps),
          purgeAllMissingSources: purgeAllMissingSourcesFactory(missingDeps),
        }),
      },
    },
    jobHandlers: defineJobHandlers({
      purge_missing: {
        payload: z.object({}),
        concurrency: 1,
        run: async () => {
          purgeExpiredMissing()
          return ok()
        },
      },
    }),
    scheduledTasks,
  })
}

export type OperationsModule = ReturnType<typeof buildOperationsModule>
