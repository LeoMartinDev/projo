import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createInMemoryRateLimiter } from './in-memory-rate-limiter.ts'

const minute = 60_000

describe('createInMemoryRateLimiter', () => {
  test('blocks at the limit until the oldest counted hit leaves the window', () => {
    const clock = createManualClock()
    const limiter = createInMemoryRateLimiter({ limit: 3, windowMs: 15 * minute, clock })
    limiter.hit('k')
    clock.advance(minute)
    limiter.hit('k')
    limiter.hit('k')
    expect(limiter.blockedFor('other')).toBeUndefined()
    expect(limiter.blockedFor('k')).toBe(14 * minute)

    clock.advance(14 * minute)
    expect(limiter.blockedFor('k')).toBeUndefined()
  })

  test('reset forgets a key', () => {
    const clock = createManualClock()
    const limiter = createInMemoryRateLimiter({ limit: 1, windowMs: minute, clock })
    limiter.hit('k')
    expect(limiter.blockedFor('k')).toBeGreaterThan(0)
    limiter.reset('k')
    expect(limiter.blockedFor('k')).toBeUndefined()
  })
})
