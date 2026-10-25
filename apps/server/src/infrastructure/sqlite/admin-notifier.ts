import { and, eq, isNull, sql } from 'drizzle-orm'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { AdminNotifier, NotificationKind } from '../../core/scanner/ports.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { notifications } from './schema/ops.ts'

const openFor = (db: Db, kind: NotificationKind, key: string) =>
  db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, kind),
        isNull(notifications.resolvedAt),
        sql`json_extract(${notifications.context}, '$.key') = ${key}`,
      ),
    )
    .get()

/**
 * Scanner notifications in `notifications` (§7.3, §7.5), one open row per (kind, key). The
 * `title_key` is the kind itself: the web translates it like an error code.
 */
export const createSqliteAdminNotifier = ({
  db,
  ids,
  clock,
  eventBus,
}: {
  db: Db
  ids: IdGenerator
  clock: Clock
  eventBus: EventBus
}): AdminNotifier => ({
  notify: ({ kind, severity, key, context }) => {
    if (openFor(db, kind, key) !== undefined) return
    const id = ids.next()
    db.insert(notifications)
      .values({
        id,
        kind,
        severity,
        titleKey: kind,
        context: { ...context, key },
        createdAt: toIso(clock.now()),
      })
      .run()
    eventBus.publish('notification.created', {
      notificationId: id,
      kind,
      severity,
      titleKey: kind,
    })
  },
  resolve: ({ kind, key }) => {
    const open = openFor(db, kind, key)
    if (open === undefined) return
    db.update(notifications)
      .set({ resolvedAt: toIso(clock.now()) })
      .where(eq(notifications.id, open.id))
      .run()
  },
})
