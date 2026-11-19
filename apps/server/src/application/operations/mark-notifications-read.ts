import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  NotificationKind,
  NotificationRepository,
} from '../../core/notifications/notification.ts'

type Deps = {
  notificationRepository: Pick<NotificationRepository, 'markAllRead'>
  clock: Clock
  logger: Logger
}

/** "Mark all read" (§15 "Notifications"): every unread notification, or those of one kind. */
export const markNotificationsReadFactory =
  ({ notificationRepository, clock, logger }: Deps) =>
  ({ kind }: { kind?: NotificationKind }): number => {
    const marked = notificationRepository.markAllRead({
      at: clock.now(),
      ...(kind === undefined ? {} : { kind }),
    })
    if (marked > 0) logger.info('notifications marked read', { count: marked, kind })
    return marked
  }

export type MarkNotificationsRead = ReturnType<typeof markNotificationsReadFactory>
