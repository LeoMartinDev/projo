import type { Clock } from '../../core/clock.ts'
import type { JobAdminRepository } from '../../core/jobs/ports.ts'
import type { NotificationRepository } from '../../core/notifications/notification.ts'
import type { StatsQueries, StorageUsage } from '../../core/stats/stats.ts'
import { isNewerVersion, satisfiesMinimum } from '../../core/updates/semver.ts'
import type { UpdateCheckStore } from '../../core/updates/update.ts'
import type { GetAdminStats } from './types.ts'

/** "Failed jobs" of the dashboard: failed for good in the last 24 h. */
export const FAILED_JOBS_WINDOW_MS = 24 * 60 * 60_000

/**
 * `GET /admin/stats` (§15 "Dashboard"): counters, running scans, active sessions, unread
 * notifications, recent failed jobs, versions, the newer release from the last check, storage.
 */
export const getAdminStatsFactory =
  ({
    statsQueries,
    notificationRepository,
    jobAdminRepository,
    checkStore,
    measureStorage,
    version,
    dataDir,
    clock,
  }: {
    statsQueries: StatsQueries
    notificationRepository: Pick<NotificationRepository, 'unreadCount'>
    jobAdminRepository: Pick<JobAdminRepository, 'countFailedSince'>
    checkStore: Pick<UpdateCheckStore, 'read'>
    measureStorage: () => Promise<StorageUsage>
    version: { app: string; runtime: string }
    dataDir: string
    clock: Clock
  }): GetAdminStats =>
  async () => {
    const latest = checkStore.read()?.latest
    const storage = await measureStorage()
    return {
      counts: statsQueries.counts(),
      runningScans: statsQueries.runningScans(),
      activePlaybackSessions: statsQueries.activePlaybackSessions(),
      unreadNotifications: notificationRepository.unreadCount(),
      failedJobs: jobAdminRepository.countFailedSince(
        new Date(clock.now().getTime() - FAILED_JOBS_WINDOW_MS),
      ),
      version,
      ...(latest === undefined || !isNewerVersion(latest.version, version.app)
        ? {}
        : {
            updateAvailable: {
              version: latest.version,
              runtimeCompatible: satisfiesMinimum(version.runtime, latest.runtimeMin),
            },
          }),
      storage: { ...storage, dataDir },
    }
  }
