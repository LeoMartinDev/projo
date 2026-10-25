import { z } from 'zod'

import { ok } from '@projo/shared'

import { jobsAdminFactory } from '../../application/operations/jobs-admin.ts'
import {
  checkDiskSpaceFactory,
  exportDatabaseFactory,
  missingSourcesAdminFactory,
  purgeExpiredMissingFactory,
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
import type { JobControl } from '../../core/jobs/ports.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { DiskUsage } from '../../core/stats/stats.ts'
import { createNodeDiskUsage } from '../../infrastructure/fs/disk-usage.ts'
import { createSqliteAdminNotifier } from '../../infrastructure/sqlite/admin-notifier.ts'
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
import { createSqliteStatsQueries } from '../../infrastructure/sqlite/stats-queries.ts'
import { createSqliteUpdateCheckStore } from '../../infrastructure/sqlite/update-check-store.ts'
import { adminJobsRoutes } from '../http/routes/admin-jobs.ts'
import { adminNotificationsRoutes } from '../http/routes/admin-notifications.ts'
import { adminMissingSourcesRoutes } from '../http/routes/admin-sources.ts'
import { adminSystemRoutes } from '../http/routes/admin-system.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import type { ScheduledTask } from '../jobs/scheduler.ts'
import type { Platform } from './platform.ts'

const minute = 60_000
const hour = 60 * minute
const day = 24 * 60 * minute

/**
 * §15 "Playback" and "Server": sections of `GET/PATCH /admin/settings`, built here and passed to
 * the metadata module that serves the route.
 */
export const buildOperationsSettings = ({ db, config, clock, logger }: Platform) => ({
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

export type OperationsSettings = ReturnType<typeof buildOperationsSettings>

export type OperationsModuleDeps = {
  /** Ends the sessions on purged files (§10.6). */
  playbackSessions: PlaybackSessionTerminator
  /**
   * From the metadata module (built later: bound by `main.ts`): purged files may change the
   * library deciding a movie or series (§9.1).
   */
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  /** The job runner (cancel, wake), built after the modules: bound later by `main.ts`. */
  jobControl: JobControl
  /** Tests: a fake disk. */
  diskUsage?: DiskUsage
}

/**
 * Wiring of the operations admin (§15): dashboard (`/admin/stats`), database export, jobs
 * (list, retry, cancel through the runner, hourly `purge-jobs`), notifications, missing sources and their purge
 * (`DELETE /admin/sources/:id`, `/admin/sources/purge-missing`, daily `purge_missing`), the
 * `cache/disk_low` and `scan/needs_review_count` checks.
 */
export const buildOperationsModule = (platform: Platform, deps: OperationsModuleDeps) => {
  const { db, ids, clock, eventBus, jobQueue, jobRepository, logger, paths, version, runtime } =
    platform
  const log = logger.child({ module: 'operations' })
  const diskUsage = deps.diskUsage ?? createNodeDiskUsage()
  const notifier = createSqliteAdminNotifier({ db, ids, clock, eventBus })
  const notificationRepository = createSqliteNotificationRepository({ db })
  const jobAdminRepository = createSqliteJobAdminRepository({ db })
  const statsQueries = createSqliteStatsQueries({ db })
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
      // Run directly: as a job, it would add a row an hour to the table it trims.
      name: 'purge-jobs',
      intervalMs: hour,
      initialDelayMs: 5 * minute,
      run: () => {
        purgeOldJobs()
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

  return {
    settings: buildOperationsSettings(platform),
    routes: {
      jobs: adminJobsRoutes({
        jobs: jobsAdminFactory({
          jobAdminRepository,
          jobRepository,
          labels: createSqliteJobTargetLabels({ db }),
          jobControl: deps.jobControl,
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
          measureStorage: measureStorageFactory({ diskUsage, paths, clock }),
          version: { app: version, runtime },
          dataDir: paths.root,
          clock,
        }),
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
    jobHandlers: {
      purge_missing: defineJobHandler({
        payload: z.object({}),
        concurrency: 1,
        run: async () => {
          purgeExpiredMissing()
          return ok()
        },
      }),
    },
    scheduledTasks,
  }
}

export type OperationsModule = ReturnType<typeof buildOperationsModule>
