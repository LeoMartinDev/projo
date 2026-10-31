import { and, count, desc, eq, inArray, isNotNull, isNull, lt, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { notificationKinds, notificationKindSchema } from '@projo/shared/api/notifications'

import type {
  Notification,
  NotificationPurge,
  NotificationRepository,
  NotificationStatus,
} from '../../core/notifications/notification.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn, stripNulls, toIso } from './rows.ts'
import { notifications } from './schema/ops.ts'

type NotificationRow = typeof notifications.$inferSelect

const contextSchema = z.record(z.string(), z.unknown())

/**
 * A row of a kind this version does not know (written by another version) is left out of the
 * lists, and does not count as unread either.
 */
const toNotification = (row: NotificationRow): Notification | undefined => {
  const kind = notificationKindSchema.safeParse(row.kind)
  if (!kind.success) return undefined
  const { readAt, resolvedAt } = stripNulls(row)
  return {
    id: row.id,
    kind: kind.data,
    severity: row.severity,
    titleKey: row.titleKey,
    context: parseJsonColumn(contextSchema, row.context, 'notifications.context'),
    createdAt: fromIso(row.createdAt),
    ...(readAt === undefined ? {} : { readAt: fromIso(readAt) }),
    ...(resolvedAt === undefined ? {} : { resolvedAt: fromIso(resolvedAt) }),
  }
}

const statusFilter = (status: NotificationStatus | undefined): SQL | undefined => {
  switch (status) {
    case undefined:
      return undefined
    case 'unread':
      return and(isNull(notifications.readAt), isNull(notifications.resolvedAt))
    case 'read':
      return and(isNotNull(notifications.readAt), isNull(notifications.resolvedAt))
    case 'resolved':
      return isNotNull(notifications.resolvedAt)
  }
}

const isKnown = (notification: Notification | undefined): notification is Notification =>
  notification !== undefined

/** `notifications` (§6.5) for the admin's notification centre (§15). */
export const createSqliteNotificationRepository = ({
  db,
}: {
  db: Db
}): NotificationRepository & NotificationPurge => ({
  list: ({ status, cursor, limit }) => {
    const rows = db
      .select()
      .from(notifications)
      .where(
        and(statusFilter(status), cursor === undefined ? undefined : lt(notifications.id, cursor)),
      )
      .orderBy(desc(notifications.id))
      .limit(limit + 1)
      .all()
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    return {
      items: pageRows.map(toNotification).filter(isKnown),
      ...(rows.length > limit && last !== undefined ? { nextCursor: last.id } : {}),
    }
  },

  unreadCount: () =>
    db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          isNull(notifications.readAt),
          isNull(notifications.resolvedAt),
          inArray(notifications.kind, [...notificationKinds]),
        ),
      )
      .get()?.total ?? 0,

  markRead: ({ id, at }) => {
    db.update(notifications)
      .set({ readAt: toIso(at) })
      .where(and(eq(notifications.id, id), isNull(notifications.readAt)))
      .run()
    const row = db.select().from(notifications).where(eq(notifications.id, id)).get()
    return row === undefined ? undefined : toNotification(row)
  },
  purgeResolvedBefore: (before) =>
    db
      .delete(notifications)
      .where(lt(notifications.resolvedAt, toIso(before)))
      .returning({ id: notifications.id })
      .all().length,
})
