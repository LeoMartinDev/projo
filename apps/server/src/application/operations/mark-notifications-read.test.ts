import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  notification,
  notificationRepository as repository,
  t0,
} from '../../../test/support/operations-world.ts'
import { listNotificationsFactory } from './list-notifications.ts'
import { markNotificationsReadFactory } from './mark-notifications-read.ts'

const world = () => {
  const notificationRepository = repository([
    notification,
    { ...notification, id: 'n2', kind: 'job/failed', titleKey: 'job/failed' },
    { ...notification, id: 'n3', kind: 'job/failed', titleKey: 'job/failed' },
    { ...notification, id: 'n4', kind: 'job/failed', resolvedAt: t0 },
  ])
  const clock = createManualClock(t0)
  return {
    markAllRead: markNotificationsReadFactory({
      notificationRepository,
      clock,
      logger: silentLogger,
    }),
    list: listNotificationsFactory({ notificationRepository }),
  }
}

describe('mark notifications read (§15 "Notifications")', () => {
  test('marks the unread ones of a kind, then every other one', () => {
    const { markAllRead, list } = world()
    expect(markAllRead({ kind: 'job/failed' })).toBe(2)
    expect(list({ limit: 20 }).unreadCount).toBe(1)
    expect(list({ limit: 20 }).items.find((entry) => entry.id === 'n4')?.readAt).toBeUndefined()
    expect(markAllRead({})).toBe(1)
    expect(list({ limit: 20 }).unreadCount).toBe(0)
    expect(markAllRead({})).toBe(0)
  })
})
