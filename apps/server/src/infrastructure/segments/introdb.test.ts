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
beforeEach(() => {
  server = startSegmentProvidersServer()
})
afterEach(() => server.stop())

const lookup = (item: SegmentItemRef, fileDurationMs?: number) =>
  createSegmentProviders({
    baseUrls: server.baseUrls,
    theintrodbApiKey: () => undefined,
    skipdbAnonymousKey: () => undefined,
    saveSkipdbAnonymousKey: () => {},
    logger: silentLogger,
  }).providers.introdb.lookup(item, fileDurationMs)

const segment = (startMs: number, endMs: number) => ({
  start_ms: startMs,
  end_ms: endMs,
  start_sec: startMs / 1000,
  end_sec: endMs / 1000,
  confidence: 0.75,
  submission_count: 4,
})

describe('IntroDB lookup (§12.2)', () => {
  test('one episode by imdb_id, season and episode: outro → credits, no_* → absent', async () => {
    expect(await lookup(items.breakingBad)).toEqual({
      ok: true,
      value: {
        segments: [{ type: 'credits', startMs: 3_431_000, endMs: 3_500_000, confidence: 1 }],
        absent: ['intro', 'recap'],
      },
    })
    expect(server.callsTo('introdb', '/segments')).toEqual([
      expect.objectContaining({
        method: 'GET',
        params: { imdb_id: 'tt0903747', season: '1', episode: '1' },
      }),
    ])
  })

  test('a movie is asked with is_movie=true; all-null segments are nothing', async () => {
    expect(await lookup(items.fightClub)).toEqual({ ok: true, value: { segments: [], absent: [] } })
    expect(server.requests[0]?.params).toEqual({ imdb_id: 'tt0137523', is_movie: 'true' })
  })

  test('a miss and a 404 are an empty lookup', async () => {
    expect(await lookup(items.breakingBadMissing)).toEqual({
      ok: true,
      value: { segments: [], absent: [] },
    })
    expect(await lookup(items.simpsons)).toEqual({ ok: true, value: { segments: [], absent: [] } })
  })

  test('no imdb id, a special or an unnumbered episode: no request', async () => {
    const { imdbId: _imdb, ...noImdb } = items.breakingBad
    const { episodeNumber: _episode, ...unnumbered } = items.breakingBad
    for (const item of [noImdb, unnumbered, { ...items.breakingBad, seasonNumber: 0 }])
      expect(await lookup(item)).toEqual({ ok: true, value: { segments: [], absent: [] } })
    expect(server.requests).toHaveLength(0)
  })

  test('post_credits is ignored, nonsensical ranges dropped, ends clamped to the file', async () => {
    server.respondNext('introdb', {
      status: 200,
      json: {
        imdb_id: 'tt0903747',
        media_type: 'tv',
        is_movie: false,
        season: 1,
        episode: 1,
        intro: segment(90_000, 30_000),
        recap: segment(0, 45_000),
        outro: segment(3_400_000, 3_500_000),
        post_credits: segment(3_480_000, 3_500_000),
        no_intro: false,
        no_recap: false,
        no_outro: false,
      },
    })
    expect(await lookup(items.breakingBad, 3_490_000)).toEqual({
      ok: true,
      value: {
        segments: [
          { type: 'recap', startMs: 0, endMs: 45_000, confidence: 0.75 },
          { type: 'credits', startMs: 3_400_000, endMs: 3_490_000, confidence: 0.75 },
        ],
        absent: [],
      },
    })
  })

  test('429 is rate limited, 5xx unavailable, garbage and off-schema invalid', async () => {
    server.respondNext(
      'introdb',
      { status: 429, json: { error: 'rate limited', limit: 60, reset_at: '2026-10-24T10:00:00Z' } },
      { status: 503, text: 'Service Unavailable' },
      { status: 200, text: 'not json' },
      { status: 200, json: { imdb_id: 'tt0903747', intro: { start_ms: '10' } } },
    )
    expect(await lookup(items.breakingBad)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_rate_limited', context: { provider: 'introdb' } },
    })
    expect(await lookup(items.breakingBad)).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable', context: { status: 503 } },
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
