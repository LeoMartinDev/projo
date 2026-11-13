import { z } from 'zod'

import { ok } from '@projo/shared'

import { jobsAdminFactory } from '../../application/operations/jobs-admin.ts'
import {
  checkDiskSpaceFactory,
  exportDatabaseFactory,
  missingSourcesAdminFactory,
  purgeExpiredMissingFactory,
  purgeOldHistoryFactory,
  purgeOldJobsFactory,
  remindNeedsReviewFactory,
} from '../../application/operations/maintenance.ts'
import { notificationsAdminFactory } from '../../application/operations/notifications-admin.ts'
import {
  playbackSettingsAdminFactory,
  serverSettingsAdminFactory,
} from '../../application/operations/settings-admin.ts'
import { getAdminStatsFactory } from '../../application/operations/stats.ts'
import { measureStorageFactory } from '../../application/operations/storage.ts'
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
const buildOperationsSettings = ({ db, config, clock }: Platform, logger: Logger) => ({
  playback: playbackSettingsAdminFactory({
    reader: createSqlitePlaybackSettings({ db }),
    writer: createSqlitePlaybackSettingsWriter({ db }),
    clock,
    logger,
  }),
  server: serverSettingsAdminFactory({
    store: createSqliteServerNameStore({ db }),
    environment: { port: config.port, trustProxy: config.trustProxy, dataDir: config.dataDir },
    clock,
  }),
})

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
          jobs: jobsAdminFactory({
            jobAdminRepository,
            jobRepository,
            labels: createSqliteJobTargetLabels({ db }),
            jobControl,
            clock,
            eventBus,
            logger: log,
          }),
        }),
        notifications: adminNotificationsRoutes({
          notifications: notificationsAdminFactory({ notificationRepository, clock }),
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
          missing: missingSourcesAdminFactory(missingDeps),
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
