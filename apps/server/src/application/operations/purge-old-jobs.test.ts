import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { day, t0 } from '../../../test/support/operations-world.ts'
import { purgeOldJobsFactory } from './purge-old-jobs.ts'

describe('job retention (§18)', () => {
  test('purges done jobs older than 7 days and failed or cancelled ones older than 30', () => {
    const calls: { doneBefore: Date; failedBefore: Date }[] = []
    const { logger, lines } = createCapturingLogger()
    const purge = purgeOldJobsFactory({
      jobRepository: {
        purgeFinished: (input) => {
          calls.push(input)
          return 4
        },
      },
      clock: createManualClock(t0),
      logger,
    })
    expect(purge()).toEqual({ deleted: 4 })
    expect(calls).toEqual([
      {
        doneBefore: new Date(t0.getTime() - 7 * day),
        failedBefore: new Date(t0.getTime() - 30 * day),
      },
    ])
    expect(lines).toEqual([{ level: 'info', message: 'old jobs purged', fields: { deleted: 4 } }])
  })

  test('nothing to purge, nothing logged', () => {
    const { logger, lines } = createCapturingLogger()
    const purge = purgeOldJobsFactory({
      jobRepository: { purgeFinished: () => 0 },
      clock: createManualClock(t0),
      logger,
    })
    expect(purge()).toEqual({ deleted: 0 })
    expect(lines).toEqual([])
  })
})
