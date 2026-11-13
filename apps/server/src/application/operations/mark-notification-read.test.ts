import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { notificationRepository as repository, t0 } from '../../../test/support/operations-fakes.ts'
import { listNotificationsFactory } from './list-notifications.ts'
import { markNotificationReadFactory } from './mark-notification-read.ts'

describe('notifications admin (§15 "Notifications")', () => {
  test('marks read once; an unknown id is not found', () => {
    const clock = createManualClock(t0)
    const notificationRepository = repository()
    const markRead = markNotificationReadFactory({ notificationRepository, clock })
    const list = listNotificationsFactory({ notificationRepository })
    expect(markRead({ id: 'n1' })).toMatchObject({ ok: true, value: { readAt: t0 } })
    clock.advance(1000)
    expect(markRead({ id: 'n1' })).toMatchObject({ ok: true, value: { readAt: t0 } })
    expect(list({ limit: 20 }).unreadCount).toBe(0)
    expect(markRead({ id: 'n2' })).toMatchObject({
      ok: false,
      error: { code: 'notification/not_found' },
    })
  })
})
