import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { day, t0 } from '../../../test/support/operations-fakes.ts'
import { purgeOldHistoryFactory } from './purge-old-history.ts'

describe('job retention (§18)', () => {
  test('purges notifications resolved and scan runs finished more than 30 days ago', () => {
    const asked: Date[] = []
    const purge = purgeOldHistoryFactory({
      notifications: { purgeResolvedBefore: (before) => (asked.push(before), 2) },
      scanRuns: { purgeFinishedBefore: (before) => (asked.push(before), 5) },
      clock: createManualClock(t0),
      logger: createCapturingLogger().logger,
    })
    expect(purge()).toEqual({ notifications: 2, scanRuns: 5 })
    expect(asked).toEqual([new Date(t0.getTime() - 30 * day), new Date(t0.getTime() - 30 * day)])
  })
})
