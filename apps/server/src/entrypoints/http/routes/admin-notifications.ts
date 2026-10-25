import { Hono } from 'hono'

import {
  type NotificationDto,
  type NotificationsPage,
  notificationsQuerySchema,
} from '@projo/shared/api/notifications'

import type { NotificationsAdmin } from '../../../application/operations/types.ts'
import type { Notification } from '../../../core/notifications/notification.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { validate } from '../validation.ts'

export const toNotificationDto = (notification: Notification): NotificationDto => ({
  id: notification.id,
  kind: notification.kind,
  severity: notification.severity,
  titleKey: notification.titleKey,
  context: notification.context,
  createdAt: notification.createdAt.toISOString(),
  ...(notification.readAt === undefined ? {} : { readAt: notification.readAt.toISOString() }),
  ...(notification.resolvedAt === undefined
    ? {}
    : { resolvedAt: notification.resolvedAt.toISOString() }),
})

/**
 * §15 "Notifications", §17.2: `GET /admin/notifications`, `POST /admin/notifications/:id/read`.
 * Mounted at `/api/v1/admin`.
 */
export const adminNotificationsRoutes = ({
  notifications,
}: {
  notifications: NotificationsAdmin
}) =>
  new Hono<AppEnv>()
    .get('/notifications', validate('query', notificationsQuerySchema), (c) => {
      const { status, cursor, limit } = c.req.valid('query')
      const page = notifications.list({
        limit,
        ...(status === undefined ? {} : { status }),
        ...(cursor === undefined ? {} : { cursor }),
      })
      const body: NotificationsPage = {
        items: page.items.map(toNotificationDto),
        unreadCount: page.unreadCount,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }
      return c.json(body, 200)
    })
    .post('/notifications/:id/read', (c) => {
      const result = notifications.markRead({ id: c.req.param('id') })
      return result.ok
        ? c.json(toNotificationDto(result.value), 200)
        : respondError(c, result.error)
    })

export type AdminNotificationsRoutes = ReturnType<typeof adminNotificationsRoutes>
