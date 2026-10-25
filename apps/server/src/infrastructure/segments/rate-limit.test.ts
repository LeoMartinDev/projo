import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { silentLogger } from '../../../test/support/logger.ts'
import {
  createFakeClock,
  recordedSegmentItems as items,
  type SegmentProvidersServer,
  startSegmentProvidersServer,
} from '../../../test/support/segment-providers-server.ts'
import { createSegmentProviders, type SegmentProvidersDeps } from './providers.ts'
import { createProviderLimiter, pauseAfter429, realSleep } from './rate-limit.ts'

const NOW = Date.parse('2026-10-24T10:00:00.000Z')

describe('provider limiter', () => {
  test('a sliding window: the (n+1)th call waits for the oldest slot to leave it', async () => {
    const clock = createFakeClock(NOW)
    const limiter = createProviderLimiter({
      provider: 'theintrodb',
      limit: { requests: 3, perMs: 10_000 },
      now: clock.now,
      sleep: clock.sleep,
    })
    const results = await Promise.all(Array.from({ length: 7 }, () => limiter.acquire()))
    expect(results.every((result) => result.ok)).toBe(true)
    // Concurrent callers reserve in order: 3 now, 3 at +10 s, 1 at +20 s.
    expect(clock.slept).toEqual([10_000, 10_000, 10_000, 20_000])
  })

  test('paused: fails at once, without waiting, until the pause ends', async () => {
    const clock = createFakeClock(NOW)
    const limiter = createProviderLimiter({
      provider: 'skipdb',
      limit: { requests: 120, perMs: 60_000 },
      now: clock.now,
      sleep: clock.sleep,
    })
    limiter.pause(30_000)
    expect(await limiter.acquire()).toMatchObject({
      ok: false,
      error: {
        code: 'segment/provider_rate_limited',
        context: { provider: 'skipdb', retryAfterSeconds: 30 },
      },
    })
    clock.advance(29_000)
    expect(await limiter.acquire()).toMatchObject({ ok: false })
    clock.advance(1_000)
    expect(await limiter.acquire()).toEqual({ ok: true, value: undefined })
    expect(clock.slept).toEqual([])
  })

  test('an aborted wait gives its slot back', async () => {
    const limiter = createProviderLimiter({
      provider: 'introdb',
      limit: { requests: 1, perMs: 60_000 },
      now: Date.now,
      sleep: realSleep,
    })
    expect((await limiter.acquire()).ok).toBe(true)
    const controller = new AbortController()
    const waiting = limiter.acquire(controller.signal)
    controller.abort()
    expect(await waiting).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { reason: 'aborted' } },
    })
  })

  test('the pause of a 429: Retry-After, else X-RateLimit-Reset, X-UsageLimit-Reset, 60 s', () => {
    const headers = (entries: Record<string, string>) => new Headers(entries)
    expect(pauseAfter429(headers({ 'retry-after': '12' }), NOW)).toBe(12_000)
    expect(
      pauseAfter429(headers({ 'retry-after': new Date(NOW + 90_000).toUTCString() }), NOW),
    ).toBe(90_000)
    expect(
      pauseAfter429(headers({ 'x-ratelimit-reset': '7', 'x-usagelimit-reset': '0' }), NOW),
    ).toBe(7_000)
    expect(pauseAfter429(headers({ 'x-usagelimit-reset': '30240' }), NOW)).toBe(30_240_000)
    expect(pauseAfter429(headers({}), NOW)).toBe(60_000)
    expect(pauseAfter429(headers({ 'x-usagelimit-reset': '999999' }), NOW)).toBe(86_400_000)
  })
})

describe('throttled providers (§12.2)', () => {
  let server: SegmentProvidersServer
  beforeEach(() => {
    server = startSegmentProvidersServer()
  })
  afterEach(() => server.stop())

  const build = (overrides: Partial<SegmentProvidersDeps>) =>
    createSegmentProviders({
      baseUrls: server.baseUrls,
      theintrodbApiKey: () => undefined,
      skipdbAnonymousKey: () => undefined,
      saveSkipdbAnonymousKey: () => {},
      logger: silentLogger,
      ...overrides,
    })

  test('a burst on TheIntroDB is spread at 30 per 10 s', async () => {
    const clock = createFakeClock(NOW)
    const { providers } = build({ now: clock.now, sleep: clock.sleep })
    const results = await Promise.all(
      Array.from({ length: 31 }, () => providers.theintrodb.lookup(items.simpsons, undefined)),
    )
    expect(results.every((result) => result.ok)).toBe(true)
    expect(clock.slept).toEqual([10_000])
    expect(server.callsTo('theintrodb', '/v4/media')).toHaveLength(31)
  })

  test('IntroDB: one request per second', async () => {
    const clock = createFakeClock(NOW)
    const { providers } = build({ now: clock.now, sleep: clock.sleep })
    await providers.introdb.lookup(items.breakingBad, undefined)
    await providers.introdb.lookup(items.breakingBad, undefined)
    expect(clock.slept).toEqual([1_000])
  })

  test('after a 429, lookups fail at once without the network until Retry-After', async () => {
    const clock = createFakeClock(NOW)
    const { providers } = build({ now: clock.now, sleep: clock.sleep })
    server.respondNext('skipdb', {
      status: 429,
      json: { error: 'Rate limited' },
      headers: { 'retry-after': '30' },
    })
    expect(await providers.skipdb.lookup(items.breakingBad, undefined)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_rate_limited', context: { retryAfterSeconds: 30 } },
    })
    expect(await providers.skipdb.lookup(items.fightClub, undefined)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_rate_limited', context: { retryAfterSeconds: 30 } },
    })
    expect(server.callsTo('skipdb')).toHaveLength(1)
    // Other providers are not paused.
    expect((await providers.theintrodb.lookup(items.simpsons, undefined)).ok).toBe(true)
    clock.advance(30_000)
    expect(await providers.skipdb.lookup(items.breakingBad, undefined)).toMatchObject({
      ok: true,
      value: { segments: [{ type: 'intro' }, { type: 'credits' }] },
    })
  })

  test('a 429 on TheIntroDB submissions does not pause its lookups; a contribution retries later', async () => {
    const clock = createFakeClock(NOW)
    const { providers, contributors } = build({
      now: clock.now,
      sleep: clock.sleep,
      theintrodbApiKey: () => 'any-key',
    })
    server.respondNext('theintrodb', {
      status: 429,
      json: { error: 'Usage limit exceeded', code: 'usage_limit_exceeded' },
      headers: { 'x-usagelimit-reset': '3600' },
    })
    const marker = { type: 'intro', startMs: 0, endMs: 24_000 } as const
    expect(await contributors.theintrodb.submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { status: 429 } },
    })
    expect(await contributors.theintrodb.submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { rateLimited: true } },
    })
    expect(server.callsTo('theintrodb', '/v4/submit')).toHaveLength(1)
    expect((await providers.theintrodb.lookup(items.simpsons, undefined)).ok).toBe(true)
  })
})
