import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { SegmentItemRef } from '../../core/segments/segment.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  createFakeClock,
  recordedSegmentItems as items,
  type SegmentProvidersServer,
  startSegmentProvidersServer,
  TEST_THEINTRODB_KEY,
} from '../../../test/support/segment-providers-server.ts'
import { createSegmentProviders, type SegmentProvidersDeps } from './providers.ts'
import { bestTimestamp } from './theintrodb.ts'

let server: SegmentProvidersServer
beforeEach(() => {
  server = startSegmentProvidersServer()
})
afterEach(() => server.stop())

const build = (overrides: Partial<SegmentProvidersDeps> = {}) =>
  createSegmentProviders({
    baseUrls: server.baseUrls,
    theintrodbApiKey: () => undefined,
    skipdbAnonymousKey: () => undefined,
    saveSkipdbAnonymousKey: () => {},
    logger: silentLogger,
    ...overrides,
  })

const lookup = (
  item: SegmentItemRef,
  fileDurationMs?: number,
  deps?: Partial<SegmentProvidersDeps>,
) => build(deps).providers.theintrodb.lookup(item, fileDurationMs)

const { tvdbId: _tvdb, tmdbId: _tmdb, ...simpsonsByImdb } = items.simpsons

describe('TheIntroDB lookup (§12.2)', () => {
  test('addresses an episode by tvdb_id with season, episode, duration and details', async () => {
    const result = await lookup(items.simpsons)
    // Recorded: intro `{ start_ms: null, end_ms: 24716 }`: a null start is the beginning.
    expect(result).toEqual({
      ok: true,
      value: {
        segments: [{ type: 'intro', startMs: 0, endMs: 24_716, confidence: 0.522525 }],
        absent: [],
      },
    })
    expect(server.callsTo('theintrodb', '/v4/media')).toEqual([
      expect.objectContaining({
        params: {
          tvdb_id: '71663',
          season: '1',
          episode: '1',
          duration_ms: '1394000',
          details: 'true',
        },
      }),
    ])
    expect(server.requests[0]?.authorization).toBeUndefined()
  })

  test('a null credits end runs until the end of the file', async () => {
    const result = await lookup(items.breakingBad, 3_499_500)
    expect(result).toMatchObject({
      ok: true,
      value: {
        segments: [
          { type: 'intro', startMs: 228_664, endMs: 246_143 },
          { type: 'credits', startMs: 3_431_000, endMs: 3_499_500, confidence: 0.25 },
        ],
      },
    })
    expect(server.requests[0]?.params['duration_ms']).toBe('3499500')
  })

  test('a null end is dropped when the file duration is unknown', async () => {
    const { durationMs: _duration, ...noDuration } = items.breakingBad
    const result = await lookup(noDuration)
    expect(result).toEqual({
      ok: true,
      value: {
        segments: [
          { type: 'intro', startMs: 228_664, endMs: 246_143, confidence: 0.68270380124852 },
        ],
        absent: [],
      },
    })
    expect(server.requests[0]?.params['duration_ms']).toBeUndefined()
  })

  test('a movie without TVDB id goes by tmdb_id, without season or episode', async () => {
    const result = await lookup(items.fightClub)
    expect(result).toMatchObject({
      ok: true,
      value: {
        segments: [
          { type: 'intro', startMs: 0, endMs: 119_000 },
          { type: 'credits', startMs: 8_177_000, endMs: 8_348_000 },
        ],
      },
    })
    expect(server.requests[0]?.params).toEqual({
      tmdb_id: '550',
      duration_ms: '8348000',
      details: 'true',
    })
  })

  test('imdb_id is the last resort; a 404 is an empty lookup', async () => {
    expect(await lookup(simpsonsByImdb)).toEqual({ ok: true, value: { segments: [], absent: [] } })
    expect(server.requests[0]?.params).toMatchObject({ imdb_id: 'tt0096697', season: '1' })
  })

  test('the three "nothing" 404 codes are an empty lookup', async () => {
    expect(await lookup(items.breakingBadMissing)).toEqual({
      ok: true,
      value: { segments: [], absent: [] },
    })
    for (const code of ['episode_not_found', 'media_not_found'])
      server.respondNext('theintrodb', { status: 404, json: { error: 'not found', code } })
    expect(await lookup(items.simpsons)).toMatchObject({ ok: true, value: { segments: [] } })
    expect(await lookup(items.simpsons)).toMatchObject({ ok: true, value: { segments: [] } })
  })

  test('no media id or an unnumbered episode: no request', async () => {
    const { tvdbId: _a, tmdbId: _b, imdbId: _c, ...anonymous } = items.simpsons
    const { episodeNumber: _d, ...unnumbered } = items.simpsons
    expect(await lookup(anonymous)).toEqual({ ok: true, value: { segments: [], absent: [] } })
    expect(await lookup(unnumbered)).toEqual({ ok: true, value: { segments: [], absent: [] } })
    expect(server.requests).toHaveLength(0)
  })

  test('sends the admin key as a Bearer token', async () => {
    await lookup(items.simpsons, undefined, { theintrodbApiKey: () => TEST_THEINTRODB_KEY })
    expect(server.requests[0]?.authorization).toBe(`Bearer ${TEST_THEINTRODB_KEY}`)
  })

  test('keeps the best entry of each type and reports 0-length answers as absent', async () => {
    server.respondNext('theintrodb', {
      status: 200,
      json: {
        tvdb_id: 71663,
        type: 'tv',
        season: 1,
        episode: 1,
        intro: [
          { start_ms: 30_000, end_ms: 90_000, confidence: 0.4, submission_count: 9 },
          { start_ms: 120_000, end_ms: 150_000, confidence: 0.8, submission_count: 2 },
          { start_ms: 200_000, end_ms: 100_000, confidence: 0.99, submission_count: 50 },
        ],
        recap: [{ start_ms: 0, end_ms: 0, confidence: 0.9, submission_count: 4 }],
        credits: [{ start_ms: -5, end_ms: 1_300_000, confidence: 1, submission_count: 3 }],
        preview: [
          { start_ms: 1_350_000, end_ms: 1_380_000, confidence: 0.5, submission_count: 1 },
          { start_ms: 1_340_000, end_ms: 1_380_000, confidence: 0.5, submission_count: 3 },
        ],
      },
    })
    expect(await lookup(items.simpsons)).toEqual({
      ok: true,
      value: {
        segments: [
          { type: 'intro', startMs: 120_000, endMs: 150_000, confidence: 0.8 },
          { type: 'preview', startMs: 1_340_000, endMs: 1_380_000, confidence: 0.5 },
        ],
        absent: ['recap'],
      },
    })
  })

  test('the best entry: confidence, then submission count, then API order', () => {
    const entries = [
      { start_ms: 1_000, end_ms: 20_000, confidence: 0.5, submission_count: 2 },
      { start_ms: 2_000, end_ms: 20_000, confidence: 0.5, submission_count: 2 },
    ]
    expect(bestTimestamp('intro', entries, undefined)).toMatchObject({
      kind: 'segment',
      candidate: { startMs: 1_000 },
    })
    expect(
      bestTimestamp('credits', [{ start_ms: 0, end_ms: undefined, confidence: 1 }], 60_000),
    ).toEqual({ kind: 'absent' })
    expect(bestTimestamp('intro', [{ start_ms: undefined, end_ms: undefined }], 60_000)).toEqual({
      kind: 'absent',
    })
    expect(bestTimestamp('credits', [{ start_ms: undefined, end_ms: 50_000 }], 60_000)).toEqual({
      kind: 'invalid',
    })
  })

  test('an end past the file is clamped; a start past it is dropped', async () => {
    server.respondNext('theintrodb', {
      status: 200,
      json: {
        tvdb_id: 1,
        type: 'tv',
        credits: [{ start_ms: 1_300_000, end_ms: 1_500_000 }],
        preview: [{ start_ms: 1_400_000, end_ms: 1_450_000 }],
      },
    })
    expect(await lookup(items.simpsons)).toEqual({
      ok: true,
      value: { segments: [{ type: 'credits', startMs: 1_300_000, endMs: 1_394_000 }], absent: [] },
    })
  })

  test('the episode-list fallback reads as nothing', async () => {
    server.respondNext('theintrodb', {
      status: 200,
      json: { tvdb_id: 71663, type: 'tv', episodes: [{ season: 1, episode: 1 }] },
    })
    expect(await lookup(items.simpsons)).toEqual({ ok: true, value: { segments: [], absent: [] } })
  })

  test('429 is rate limited, 5xx and timeouts unavailable, garbage invalid', async () => {
    server.respondNext(
      'theintrodb',
      { status: 429, json: { error: 'Too Many Requests' }, headers: { 'x-ratelimit-reset': '7' } },
      { status: 500, json: { error: 'Failed to retrieve submissions' } },
      { status: 200, text: '<html>oops</html>' },
      { status: 200, json: { type: 'tv', intro: 'soon' } },
      { status: 400, json: { error: 'Season 1 Episode 1 does not exist on TVDB' } },
      { status: 200, json: {}, delayMs: 300 },
    )
    expect(await lookup(items.simpsons)).toMatchObject({
      ok: false,
      error: {
        code: 'segment/provider_rate_limited',
        context: { provider: 'theintrodb', status: 429, retryAfterSeconds: 7 },
      },
    })
    expect(await lookup(items.simpsons)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { status: 500 } },
    })
    expect(await lookup(items.simpsons)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_invalid_response' },
    })
    expect(await lookup(items.simpsons)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_invalid_response' },
    })
    expect(await lookup(items.simpsons)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_invalid_response', context: { status: 400 } },
    })
    expect(await lookup(items.simpsons, undefined, { timeoutMs: 50 })).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { reason: 'timeout' } },
    })
  })

  test('an unreachable server is unavailable', async () => {
    const result = await lookup(items.simpsons, undefined, {
      fetch: Object.assign(async () => Promise.reject(new TypeError('fetch failed')), {
        preconnect: fetch.preconnect,
      }),
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'segment/provider_unavailable',
        context: { reason: 'TypeError: fetch failed' },
      },
    })
  })
})

describe('TheIntroDB contribution (§12.5)', () => {
  const contributor = (key: string = TEST_THEINTRODB_KEY) =>
    build({ theintrodbApiKey: () => key }).contributors.theintrodb

  test('submits an episode marker by tvdb_id, in milliseconds, with the release duration', async () => {
    const result = await contributor().submit(items.breakingBad, {
      type: 'intro',
      startMs: 228_500.4,
      endMs: 246_000,
    })
    expect(result).toEqual({ ok: true, value: undefined })
    const [submission] = server.callsTo('theintrodb', '/v4/submit')
    expect(submission?.method).toBe('POST')
    expect(submission?.authorization).toBe(`Bearer ${TEST_THEINTRODB_KEY}`)
    expect(submission?.body).toEqual({
      type: 'tv',
      segment: 'intro',
      tvdb_id: 81189,
      season: 1,
      episode: 1,
      start_ms: 228_500,
      end_ms: 246_000,
      video_duration_ms: 3_500_000,
    })
  })

  test('a movie goes without season and episode', async () => {
    await contributor().submit(items.fightClub, {
      type: 'credits',
      startMs: 8_177_000,
      endMs: 8_348_000,
    })
    expect(server.callsTo('theintrodb', '/v4/submit')[0]?.body).toEqual({
      type: 'movie',
      segment: 'credits',
      tmdb_id: 550,
      start_ms: 8_177_000,
      end_ms: 8_348_000,
      video_duration_ms: 8_348_000,
    })
  })

  test('refusals: no key, refused key, conflict; 5xx is worth a retry', async () => {
    const marker = { type: 'intro', startMs: 0, endMs: 24_000 } as const
    const withoutKey = build({ theintrodbApiKey: () => undefined }).contributors.theintrodb
    expect(await withoutKey.submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: { code: 'segment/submission_failed', context: { reason: 'missing_key' } },
    })
    expect(server.requests).toHaveLength(0)
    expect(await contributor('wrong').submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: { code: 'segment/submission_failed', context: { status: 401 } },
    })
    server.respondNext(
      'theintrodb',
      { status: 409, json: { error: 'You have already submitted this exact segment' } },
      { status: 503, json: { error: 'Unable to verify account status' } },
      { status: 200, json: { ok: false } },
    )
    expect(await contributor().submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: {
        code: 'segment/submission_failed',
        context: { status: 409, reason: 'You have already submitted this exact segment' },
      },
    })
    expect(await contributor().submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { status: 503 } },
    })
    expect(await contributor().submit(items.simpsons, marker)).toMatchObject({
      ok: false,
      error: { code: 'segment/submission_failed', context: { reason: 'invalid_response' } },
    })
  })
})

describe('TheIntroDB key check', () => {
  test('a POST /map dry run proves the key', async () => {
    const { validateTheintrodbKey } = build()
    expect(await validateTheintrodbKey(TEST_THEINTRODB_KEY)).toEqual({ ok: true, value: undefined })
    expect(server.callsTo('theintrodb', '/v4/map')).toEqual([
      expect.objectContaining({
        method: 'POST',
        authorization: `Bearer ${TEST_THEINTRODB_KEY}`,
        body: { type: 'movie', tvdb_id: 247 },
      }),
    ])
  })

  test('401 and an empty key are refused; 429 and 5xx are not a verdict', async () => {
    const clock = createFakeClock()
    const { validateTheintrodbKey } = build({ now: clock.now, sleep: clock.sleep })
    expect(await validateTheintrodbKey('not-a-key')).toMatchObject({
      ok: false,
      error: { code: 'segment/theintrodb_key_invalid', context: { status: 401 } },
    })
    expect(await validateTheintrodbKey('  ')).toMatchObject({
      ok: false,
      error: { code: 'segment/theintrodb_key_invalid' },
    })
    expect(server.requests).toHaveLength(1)
    server.respondNext(
      'theintrodb',
      { status: 429, json: {} },
      { status: 502, text: 'bad gateway' },
    )
    expect(await validateTheintrodbKey(TEST_THEINTRODB_KEY)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_rate_limited', context: { retryAfterSeconds: 60 } },
    })
    // A 429 without headers pauses one minute, without calling the network.
    expect(await validateTheintrodbKey(TEST_THEINTRODB_KEY)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_rate_limited' },
    })
    expect(server.requests).toHaveLength(2)
    clock.advance(60_000)
    expect(await validateTheintrodbKey(TEST_THEINTRODB_KEY)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable' },
    })
  })
})
