import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { t0 } from '../../../test/support/operations-world.ts'
import type { StatsQueries } from '../../core/stats/stats.ts'
import type { UpdateCheckRecord } from '../../core/updates/update.ts'
import { getAdminStatsFactory } from './get-admin-stats.ts'

describe('storage and dashboard (§15)', () => {
  test('the dashboard says a newer release is available, and whether the runtime allows it', async () => {
    const statsQueries: StatsQueries = {
      counts: () => ({
        movies: 2,
        series: 1,
        episodes: 10,
        pendingSources: 1,
        needsReview: 3,
        missingSources: 0,
      }),
      runningScans: () => [],
      activePlaybackSessions: () => 2,
    }
    const check: Pick<UpdateCheckRecord, 'latest'> = {}
    const stats = getAdminStatsFactory({
      statsQueries,
      notificationRepository: { unreadCount: () => 4 },
      jobAdminRepository: { countFailedSince: (since) => (since < t0 ? 1 : 0) },
      checkStore: { read: () => ({ checkedAt: t0, ...check }) },
      version: { app: '1.0.0', runtime: '1.0.0' },
      clock: createManualClock(t0),
    })
    const current = stats()
    expect(current).toMatchObject({
      activePlaybackSessions: 2,
      unreadNotifications: 4,
      failedJobs: 1,
      counts: { needsReview: 3 },
    })
    expect(current.updateAvailable).toBeUndefined()
    check.latest = {
      version: '1.1.0',
      tag: 'v1.1.0',
      publishedAt: t0,
      notes: '',
      url: 'https://example.test',
      archive: { name: 'a', url: 'u', sizeBytes: 1 },
      checksums: { name: 'c', url: 'u', sizeBytes: 1 },
      runtimeMin: '1.2.0',
    }
    expect(stats().updateAvailable).toEqual({ version: '1.1.0', runtimeCompatible: false })
  })
})
