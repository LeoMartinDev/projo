import type {
  Notification,
  NotificationRepository,
  NotificationStatus,
} from '../../core/notifications/notification.ts'

type Deps = { notificationRepository: Pick<NotificationRepository, 'list' | 'unreadCount'> }

export const listNotificationsFactory =
  ({ notificationRepository }: Deps) =>
  (input: {
    status?: NotificationStatus
    cursor?: string
    limit: number
  }): { items: Notification[]; nextCursor?: string; unreadCount: number } => ({
    ...notificationRepository.list(input),
    unreadCount: notificationRepository.unreadCount(),
  })

export type ListNotifications = ReturnType<typeof listNotificationsFactory>
