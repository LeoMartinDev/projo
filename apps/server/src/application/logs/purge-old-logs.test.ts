import { expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { purgeOldLogsFactory } from './purge-old-logs.ts'

test('purges what is older than the retention and beyond its line count', () => {
  const calls: { before: Date; keep: number }[] = []
  const purge = purgeOldLogsFactory({
    logStore: {
      purge: (input) => {
        calls.push(input)
        return 3
      },
    },
    clock: createManualClock(new Date('2026-11-15T12:00:00.000Z')),
    logger: silentLogger,
  })
  expect(purge()).toBe(3)
  expect(calls).toEqual([{ before: new Date('2026-11-01T12:00:00.000Z'), keep: 500_000 }])
})
