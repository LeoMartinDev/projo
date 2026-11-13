import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { purgeTmdbResponsesFactory } from './purge-tmdb-responses.ts'

describe('metadata retention (§18 "Rules")', () => {
  test('TMDB responses older than the longest age a reader accepts (30 days)', () => {
    const now = new Date('2026-10-31T00:00:00.000Z')
    const asked: Date[] = []
    const purge = purgeTmdbResponsesFactory({
      responses: { purgeFetchedBefore: (before) => (asked.push(before), 3) },
      clock: createManualClock(now),
      logger: silentLogger,
    })
    expect(purge()).toEqual({ deleted: 3 })
    expect(asked).toEqual([new Date('2026-10-01T00:00:00.000Z')])
  })
})
