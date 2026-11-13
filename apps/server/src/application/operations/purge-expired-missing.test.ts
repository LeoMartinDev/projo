import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import {
  createMissingSourcesWorld as build,
  day,
  t0,
} from '../../../test/support/operations-fakes.ts'
import { purgeExpiredMissingFactory } from './purge-expired-missing.ts'

describe('missing sources (§7.5, §15 "Manquants")', () => {
  test('the daily purge takes the sources missing for more than 30 days', () => {
    const { deps, purgedBatches } = build({
      old: { state: 'missing', missingSince: new Date(t0.getTime() - 31 * day) },
      recent: { state: 'missing', missingSince: new Date(t0.getTime() - 29 * day) },
    })
    expect(purgeExpiredMissingFactory({ ...deps, clock: createManualClock(t0) })()).toEqual({
      purged: 1,
    })
    expect(purgedBatches).toEqual([['old']])
  })
})
