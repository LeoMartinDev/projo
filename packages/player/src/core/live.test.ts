import { describe, expect, test } from 'bun:test'

import { playerFailure } from './failure.ts'
import {
  adjacentChannel,
  creationFailureReaction,
  heartbeatFailureReaction,
  isAtLive,
  liveBoundsAt,
  steadyLiveBounds,
  liveDelayMs,
  liveEdgePoint,
  liveGapsOf,
  livePointAt,
  liveResumePoint,
  liveSeekPoint,
  type LiveWindow,
  parseLiveWindow,
} from './live.ts'

describe('live rules (§29.5)', () => {
  test('the adjacent channel follows the order and wraps at both ends', () => {
    const order = ['a', 'b', 'c']
    expect(adjacentChannel(order, 'a', 1)).toBe('b')
    expect(adjacentChannel(order, 'c', 1)).toBe('a')
    expect(adjacentChannel(order, 'a', -1)).toBe('c')
    expect(adjacentChannel(order, 'b', -1)).toBe('a')
  })

  test('no adjacent channel for a channel alone or not listed', () => {
    expect(adjacentChannel(['a'], 'a', 1)).toBeUndefined()
    expect(adjacentChannel(['a', 'b'], 'z', 1)).toBeUndefined()
    expect(adjacentChannel([], 'a', -1)).toBeUndefined()
  })

  test('a creation reconnects only when the network is lost', () => {
    expect(creationFailureReaction(playerFailure(0, 'network', 'offline'))).toBe('reconnect')
    for (const code of [
      'tv/stream_unavailable',
      'tv/connection_limit_reached',
      'tv/channel_not_found',
    ] as const)
      expect(creationFailureReaction(playerFailure(503, code, code))).toBe('block')
  })

  test('a heartbeat replaces a session gone, blocks on a failed stream, ignores the rest', () => {
    expect(heartbeatFailureReaction(playerFailure(404, 'tv/session_not_found', ''))).toBe(
      'reconnect',
    )
    expect(heartbeatFailureReaction(playerFailure(502, 'tv/stream_unavailable', ''))).toBe('block')
    expect(heartbeatFailureReaction(playerFailure(404, 'tv/channel_not_found', ''))).toBe('block')
    expect(heartbeatFailureReaction(playerFailure(0, 'network', ''))).toBeUndefined()
  })
})

const t0 = Date.parse('2026-11-18T20:00:00.000Z')

// Segments 40 to 44 of a first run, then (after a 10 s restart gap) 45 and 46 of a second.
const served = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:40',
  '#EXT-X-DISCONTINUITY-SEQUENCE:1',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-START:TIME-OFFSET=-6',
  '#EXT-X-MAP:URI="init-2.mp4"',
  '#EXT-X-PROGRAM-DATE-TIME:2026-11-18T20:00:00.000Z',
  '#EXTINF:2.000,',
  'seg-2-00040.m4s',
  '#EXTINF:2.000,',
  'seg-2-00041.m4s',
  '#EXTINF:2.500,',
  'seg-2-00042.m4s',
  '#EXTINF:1.500,',
  'seg-2-00043.m4s',
  '#EXTINF:2.000,',
  'seg-2-00044.m4s',
  '#EXT-X-DISCONTINUITY',
  '#EXT-X-MAP:URI="init-3.mp4"',
  '#EXT-X-PROGRAM-DATE-TIME:2026-11-18T20:00:20.000Z',
  '#EXTINF:2.000,',
  'seg-3-00000.m4s',
  '#EXTINF:2.000,',
  'seg-3-00001.m4s',
  '',
].join('\n')

describe('timeshift rules (§29.5)', () => {
  const window = parseLiveWindow(served) as LiveWindow

  test("reads the window's segments from the program dates and the durations", () => {
    expect(window.targetS).toBe(4)
    expect(window.segments).toEqual([
      { sequence: 40, startMs: t0, durationMs: 2000 },
      { sequence: 41, startMs: t0 + 2000, durationMs: 2000 },
      { sequence: 42, startMs: t0 + 4000, durationMs: 2500 },
      { sequence: 43, startMs: t0 + 6500, durationMs: 1500 },
      { sequence: 44, startMs: t0 + 8000, durationMs: 2000 },
      { sequence: 45, startMs: t0 + 20_000, durationMs: 2000 },
      { sequence: 46, startMs: t0 + 22_000, durationMs: 2000 },
    ])
    expect(liveGapsOf(window)).toEqual([{ fromMs: t0 + 10_000, toMs: t0 + 20_000 }])
  })

  test('no window without program dates (an older server) or without segments', () => {
    expect(
      parseLiveWindow(served.replaceAll(/#EXT-X-PROGRAM-DATE-TIME:\S+\n/gu, '')),
    ).toBeUndefined()
    expect(parseLiveWindow('#EXTM3U\n#EXT-X-TARGETDURATION:4\n')).toBeUndefined()
    expect(parseLiveWindow('')).toBeUndefined()
  })

  test('the edge moves with the clock between two reads, one target duration at most', () => {
    expect(liveBoundsAt(window, t0 + 24_000, t0 + 24_000)).toEqual({
      startMs: t0,
      edgeMs: t0 + 24_000,
    })
    expect(liveBoundsAt(window, t0 + 24_000, t0 + 27_000).edgeMs).toBe(t0 + 27_000)
    expect(liveBoundsAt(window, t0 + 24_000, t0 + 90_000).edgeMs).toBe(
      t0 + 24_000 + window.targetS * 1000,
    )
  })

  test('the edge shown never moves back while a stream plays', () => {
    const read = liveBoundsAt(window, t0 + 24_000, t0 + 24_000)
    expect(steadyLiveBounds(read, undefined)).toEqual(read)
    expect(steadyLiveBounds(read, t0 + 26_000)).toEqual({ startMs: t0, edgeMs: t0 + 26_000 })
    expect(steadyLiveBounds(read, t0 + 20_000)).toEqual(read)
  })

  test('a point names the segment holding it; a gap goes to the segment after it', () => {
    expect(livePointAt(window, t0 + 7000)).toEqual({
      atMs: t0 + 7000,
      sequence: 43,
      segmentStartMs: t0 + 6500,
    })
    expect(livePointAt(window, t0 + 15_000)).toEqual({
      atMs: t0 + 20_000,
      sequence: 45,
      segmentStartMs: t0 + 20_000,
    })
    expect(livePointAt(window, t0 - 5000)).toMatchObject({ atMs: t0, sequence: 40 })
    expect(livePointAt(window, t0 + 99_000)).toMatchObject({ atMs: t0 + 24_000, sequence: 46 })
  })

  test('a seek is clamped to the window; at or past the live point it is the live point', () => {
    const bounds = liveBoundsAt(window, t0 + 24_000, t0 + 24_000)
    expect(liveEdgePoint(window, bounds)).toEqual({
      atMs: t0 + 20_000,
      sequence: 45,
      segmentStartMs: t0 + 20_000,
      live: true,
    })
    expect(liveSeekPoint(window, bounds, t0 + 23_000)).toMatchObject({ live: true })
    expect(liveSeekPoint(window, bounds, t0 + 5000)).toEqual({
      atMs: t0 + 5000,
      sequence: 42,
      segmentStartMs: t0 + 4000,
    })
    // No earlier than the start plus one target duration.
    expect(liveSeekPoint(window, bounds, t0 - 60_000)).toMatchObject({ atMs: t0 + 4000 })
  })

  test('play resumes where it paused, unless that point left the window', () => {
    const bounds = liveBoundsAt(window, t0 + 24_000, t0 + 24_000)
    expect(liveResumePoint(window, bounds, t0 + 1000)).toBeUndefined()
    // Out of it: the start plus the larger of three target durations (12 s) and 10 s, which
    // falls in the gap: the segment after it.
    expect(liveResumePoint(window, bounds, t0 - 1)).toMatchObject({ atMs: t0 + 20_000 })
  })

  test('the delay behind the live point, and at live within 6 s plus two targets', () => {
    const bounds = { startMs: t0, edgeMs: t0 + 60_000 }
    expect(liveDelayMs(bounds, t0 + 54_000)).toBe(0)
    expect(liveDelayMs(bounds, t0 + 58_000)).toBe(0)
    expect(liveDelayMs(bounds, t0 + 30_000)).toBe(24_000)
    expect(isAtLive(window, bounds, t0 + 46_000)).toBe(true)
    expect(isAtLive(window, bounds, t0 + 45_999)).toBe(false)
  })
})
