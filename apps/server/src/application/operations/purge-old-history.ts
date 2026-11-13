import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { NotificationPurge } from '../../core/notifications/notification.ts'
import type { ScanRunRepository } from '../../core/scanner/ports.ts'

export const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60_000

type Deps = {
  notifications: NotificationPurge
  scanRuns: Pick<ScanRunRepository, 'purgeFinishedBefore'>
  clock: Clock
  logger: Logger
}

export const purgeOldHistoryFactory =
  ({ notifications, scanRuns, clock, logger }: Deps) =>
  (): { notifications: number; scanRuns: number } => {
    const before = new Date(clock.now().getTime() - HISTORY_RETENTION_MS)
    const deleted = {
      notifications: notifications.purgeResolvedBefore(before),
      scanRuns: scanRuns.purgeFinishedBefore(before),
    }
    if (deleted.notifications + deleted.scanRuns > 0) logger.info('old history purged', deleted)
    return deleted
  }

export type PurgeOldHistory = ReturnType<typeof purgeOldHistoryFactory>
