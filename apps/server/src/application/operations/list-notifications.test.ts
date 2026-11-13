import { describe, expect, test } from 'bun:test'

import { notificationRepository as repository } from '../../../test/support/operations-world.ts'
import { listNotificationsFactory } from './list-notifications.ts'

describe('notifications admin (§15 "Notifications")', () => {
  test('lists with the unread count of every page', () => {
    const list = listNotificationsFactory({ notificationRepository: repository() })
    expect(list({ limit: 20 })).toMatchObject({ unreadCount: 1, items: [{ id: 'n1' }] })
  })
})
