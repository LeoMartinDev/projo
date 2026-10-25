import { appError, err, ok } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { NotificationRepository } from '../../core/notifications/notification.ts'
import type { NotificationsAdmin } from './types.ts'

/** §15 "Notifications": the centre (unread, read, resolved) and "lu". */
export const notificationsAdminFactory = ({
  notificationRepository,
  clock,
}: {
  notificationRepository: NotificationRepository
  clock: Clock
}): NotificationsAdmin => ({
  list: (input) => ({
    ...notificationRepository.list(input),
    unreadCount: notificationRepository.unreadCount(),
  }),
  markRead: ({ id }) => {
    const notification = notificationRepository.markRead({ id, at: clock.now() })
    return notification === undefined
      ? err(appError('notification/not_found', 'notification not found', { context: { id } }))
      : ok(notification)
  },
})
