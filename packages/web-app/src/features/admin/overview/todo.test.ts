import { describe, expect, test } from 'bun:test'

import type { NotificationDto, NotificationKind } from '@projo/shared/api/notifications'

import { todoItems } from './todo.ts'

const unread = (id: string, kind: NotificationKind): NotificationDto => ({
  id,
  kind,
  severity: 'warning',
  titleKey: kind,
  context: {},
  createdAt: '2026-11-18T10:00:00.000Z',
})

const stats = (
  overrides: {
    needsReview?: number
    missingSources?: number
    failedJobs?: number
    update?: { version: string; runtimeCompatible: boolean }
  } = {},
) => ({
  counts: {
    movies: 0,
    series: 0,
    episodes: 0,
    pendingSources: 0,
    needsReview: overrides.needsReview ?? 0,
    missingSources: overrides.missingSources ?? 0,
  },
  failedJobs: overrides.failedJobs ?? 0,
  ...(overrides.update === undefined ? {} : { updateAvailable: overrides.update }),
})

describe('overview "To do" (§15)', () => {
  test('nothing to do', () => {
    expect(todoItems({ tmdbKey: 'valid', stats: stats(), unread: [] })).toEqual([])
    expect(todoItems({ tmdbKey: undefined, stats: undefined, unread: [] })).toEqual([])
  })

  test('live subjects first, in a fixed order', () => {
    const items = todoItems({
      tmdbKey: 'rejected',
      stats: stats({
        needsReview: 4,
        missingSources: 2,
        failedJobs: 1,
        update: { version: '1.30.0', runtimeCompatible: false },
      }),
      unread: [],
    })
    expect(items).toEqual([
      { kind: 'tmdb', state: 'rejected' },
      { kind: 'review', count: 4 },
      { kind: 'missing', count: 2 },
      { kind: 'failedJobs', count: 1 },
      { kind: 'update', version: '1.30.0', runtimeCompatible: false },
    ])
  })

  test('unread notifications grouped by kind, newest kind first, with the newest of each', () => {
    const items = todoItems({
      tmdbKey: 'valid',
      stats: stats(),
      unread: [
        unread('n5', 'tv/source_unreachable'),
        unread('n4', 'scan/unsupported_layout'),
        unread('n3', 'tv/source_unreachable'),
        unread('n2', 'scan/unsupported_layout'),
        unread('n1', 'cache/disk_low'),
      ],
    })
    expect(
      items.map((item) =>
        item.kind === 'notifications' ? [item.notificationKind, item.count, item.latest.id] : [],
      ),
    ).toEqual([
      ['tv/source_unreachable', 2, 'n5'],
      ['scan/unsupported_layout', 2, 'n4'],
      ['cache/disk_low', 1, 'n1'],
    ])
  })

  test('a kind a live subject says is not repeated; without that subject it shows', () => {
    const notifications = [
      unread('n6', 'scan/needs_review_count'),
      unread('n5', 'tmdb/unauthorized'),
      unread('n4', 'job/failed'),
      unread('n3', 'update/available'),
      unread('n2', 'update/runtime_too_old'),
      unread('n1', 'scan/many_missing'),
    ]
    const covered = todoItems({
      tmdbKey: 'rejected',
      stats: stats({
        needsReview: 1,
        missingSources: 1,
        failedJobs: 1,
        update: { version: '1.30.0', runtimeCompatible: false },
      }),
      unread: notifications,
    })
    expect(covered.filter((item) => item.kind === 'notifications')).toEqual([])

    const stale = todoItems({ tmdbKey: 'valid', stats: stats(), unread: notifications })
    expect(stale.map((item) => item.kind === 'notifications' && item.notificationKind)).toEqual([
      'scan/needs_review_count',
      'tmdb/unauthorized',
      'job/failed',
      'update/available',
      'update/runtime_too_old',
      'scan/many_missing',
    ])
  })

  test('a compatible update leaves "runtime too old" notifications apart', () => {
    const items = todoItems({
      tmdbKey: 'valid',
      stats: stats({ update: { version: '1.30.0', runtimeCompatible: true } }),
      unread: [unread('n2', 'update/runtime_too_old'), unread('n1', 'update/available')],
    })
    expect(items.map((item) => item.kind)).toEqual(['update', 'notifications'])
  })
})
