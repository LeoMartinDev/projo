import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { SegmentItemRef } from '../../core/segments/segment.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  recordedSegmentItems as items,
  type SegmentProvidersServer,
  startSegmentProvidersServer,
} from '../../../test/support/segment-providers-server.ts'
import { createSegmentProviders } from './providers.ts'

let server: SegmentProvidersServer
let storedKey: string | undefined
let saved: string[]
beforeEach(() => {
  server = startSegmentProvidersServer()
  storedKey = undefined
  saved = []
})
afterEach(() => server.stop())

const build = () =>
  createSegmentProviders({
    baseUrls: server.baseUrls,
    theintrodbApiKey: () => undefined,
    skipdbAnonymousKey: () => storedKey,
    saveSkipdbAnonymousKey: (key) => {
      storedKey = key
      saved.push(key)
    },
    logger: silentLogger,
  })

const lookup = (item: SegmentItemRef, fileDurationMs?: number) =>
  build().providers.skipdb.lookup(item, fileDurationMs)

const segment = (startMs: number, endMs: number, match = 'exact') => ({
  start_ms: startMs,
  end_ms: endMs,
  adjusted: false,
  offset_ms: 0,
  match,
  confidence: 0.9,
})

describe('SkipDB lookup (§12.2)', () => {
  test('by imdb_id, season, episode and the duration in seconds: outro → credits', async () => {
    expect(await lookup(items.breakingBad)).toEqual({
      ok: true,
      value: {
        segments: [
          { type: 'intro', startMs: 229_500, endMs: 246_500, confidence: 0.9 },
          { type: 'credits', startMs: 3_434_000, endMs: 3_500_000, confidence: 0.9 },
        ],
        absent: [],
      },
    })
    expect(server.callsTo('skipdb', '/api/segments')).toEqual([
      expect.objectContaining({
        method: 'GET',
        params: { imdb_id: 'tt0903747', season: '1', episode: '1', duration: '3500' },
      }),
    ])
  })

  test('a movie goes without season or episode; a shifted match is kept', async () => {
    expect(await lookup(items.fightClub, 8_348_382)).toEqual({
      ok: true,
      value: {
        segments: [{ type: 'credits', startMs: 8_146_800, endMs: 8_342_300, confidence: 0.82 }],
        absent: [],
      },
    })
    expect(server.requests[0]?.params).toEqual({ imdb_id: 'tt0137523', duration: '8348.382' })
  })

  test('a miss is an empty lookup; no imdb id: no request', async () => {
    expect(await lookup(items.breakingBadMissing)).toEqual({
      ok: true,
      value: { segments: [], absent: [] },
    })
    const { imdbId: _imdb, ...noImdb } = items.breakingBad
    expect(await lookup(noImdb)).toEqual({ ok: true, value: { segments: [], absent: [] } })
    expect(server.requests).toHaveLength(1)
  })

  test('0/0 is a confirmed absence; out-of-range and nonsensical ranges are dropped', async () => {
    server.respondNext('skipdb', {
      status: 200,
      json: {
        imdb_id: 'tt0903747',
        season: 1,
        episode: 1,
        segments: {
          intro: segment(0, 0),
          recap: segment(10_000, 40_000, 'out-of-range'),
          outro: segment(3_450_000, 3_440_000),
          preview: segment(3_480_000, 3_520_000, 'agnostic'),
        },
        intro_length_estimate_ms: 17_000,
      },
    })
    expect(await lookup(items.breakingBad)).toEqual({
      ok: true,
      value: {
        segments: [{ type: 'preview', startMs: 3_480_000, endMs: 3_500_000, confidence: 0.9 }],
        absent: ['intro'],
      },
    })
  })

  test('429 is rate limited, 5xx unavailable, garbage invalid', async () => {
    server.respondNext(
      'skipdb',
      { status: 429, json: { error: 'Rate limited' }, headers: { 'retry-after': '30' } },
      { status: 500, json: { error: 'boom' } },
      { status: 200, text: '{"imdb_id":' },
      { status: 200, json: { imdb_id: 'tt0903747' } },
    )
    expect(await lookup(items.breakingBad)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_rate_limited', context: { retryAfterSeconds: 30 } },
    })
    expect(await lookup(items.breakingBad)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable' },
    })
    expect(await lookup(items.breakingBad)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_invalid_response' },
    })
    expect(await lookup(items.breakingBad)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_invalid_response' },
    })
  })
})

describe('SkipDB contribution (§12.5)', () => {
  const credits = { type: 'credits', startMs: 3_434_000, endMs: 3_500_000 } as const

  test('creates an anonymous key on first use, stores it, then submits with it', async () => {
    const { contributors } = build()
    expect(await contributors.skipdb.submit(items.breakingBad, credits)).toEqual({
      ok: true,
      value: undefined,
    })
    expect(saved).toEqual(['skdb_live_test0001'])
    const [submission] = server.callsTo('skipdb', '/api/segments')
    expect(submission?.method).toBe('POST')
    expect(submission?.apiKey).toBe('skdb_live_test0001')
    expect(submission?.body).toEqual({
      imdb_id: 'tt0903747',
      segment_type: 'outro',
      season: 1,
      episode: 1,
      start_ms: 3_434_000,
      end_ms: 3_500_000,
      duration_ms: 3_500_000,
    })

    await contributors.skipdb.submit(items.fightClub, { type: 'intro', startMs: 0, endMs: 60_000 })
    expect(server.callsTo('skipdb', '/api/keys/anonymous')).toHaveLength(1)
    expect(server.callsTo('skipdb', '/api/segments')[1]?.body).toEqual({
      imdb_id: 'tt0137523',
      segment_type: 'intro',
      start_ms: 0,
      end_ms: 60_000,
      duration_ms: 8_348_000,
    })
  })

  test('concurrent first submissions share one key creation', async () => {
    const { contributors } = build()
    const results = await Promise.all([
      contributors.skipdb.submit(items.breakingBad, credits),
      contributors.skipdb.submit(items.breakingBad, {
        type: 'intro',
        startMs: 229_000,
        endMs: 246_000,
      }),
    ])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(server.callsTo('skipdb', '/api/keys/anonymous')).toHaveLength(1)
  })

  test('a key SkipDB no longer accepts is replaced once', async () => {
    const { contributors } = build()
    await contributors.skipdb.submit(items.breakingBad, credits)
    server.revokeSkipdbKeys()
    expect(await contributors.skipdb.submit(items.breakingBad, credits)).toMatchObject({ ok: true })
    expect(saved).toEqual(['skdb_live_test0001', 'skdb_live_test0002'])
    expect(server.callsTo('skipdb', '/api/segments').map((r) => r.apiKey)).toEqual([
      'skdb_live_test0001',
      'skdb_live_test0001',
      'skdb_live_test0002',
    ])
  })

  test('refusals: no imdb id, rejected, 422; 429 on key creation is worth a retry', async () => {
    const { contributors } = build()
    const { imdbId: _imdb, ...noImdb } = items.breakingBad
    expect(await contributors.skipdb.submit(noImdb, credits)).toMatchObject({
      ok: false,
      error: { code: 'segment/submission_failed', context: { reason: 'missing_imdb_id' } },
    })
    expect(server.requests).toHaveLength(0)

    server.respondNext('skipdb', { status: 429, json: { error: 'Too many keys from this IP' } })
    expect(await contributors.skipdb.submit(items.breakingBad, credits)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { status: 429 } },
    })
    expect(saved).toEqual([])

    storedKey = 'skdb_live_test0001'
    server.respondNext(
      'skipdb',
      {
        status: 201,
        json: { id: 7, status: 'rejected', auto_approved: false, reasons: ['overlap'] },
      },
      { status: 422, json: { error: 'Failed validation', issues: [] } },
    )
    expect(await contributors.skipdb.submit(items.breakingBad, credits)).toMatchObject({
      ok: false,
      error: {
        code: 'segment/submission_failed',
        context: { reason: 'rejected', submissionId: 7 },
      },
    })
    expect(await contributors.skipdb.submit(items.breakingBad, credits)).toMatchObject({
      ok: false,
      error: { code: 'segment/submission_failed', context: { status: 422 } },
    })
  })
})
