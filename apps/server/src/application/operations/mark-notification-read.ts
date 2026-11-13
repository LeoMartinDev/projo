import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Notification, NotificationRepository } from '../../core/notifications/notification.ts'

type Deps = {
  notificationRepository: Pick<NotificationRepository, 'markRead'>
  clock: Clock
}

export type MarkNotificationReadError = AppError<'notification/not_found'>

export const markNotificationReadFactory =
  ({ notificationRepository, clock }: Deps) =>
  ({ id }: { id: string }): Result<Notification, MarkNotificationReadError> => {
    const notification = notificationRepository.markRead({ id, at: clock.now() })
    return notification === undefined
      ? err(appError('notification/not_found', 'notification not found', { context: { id } }))
      : ok(notification)
  }

export type MarkNotificationRead = ReturnType<typeof markNotificationReadFactory>
