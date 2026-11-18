import { describe, expect, test } from 'bun:test'

import { cacheTrimOf, expiredDeletionAt, segmentStartsOf } from './live-window.ts'

const t0 = Date.parse('2026-11-18T20:00:00.000Z')

describe('the replay window (§29.4)', () => {
  test("a run's first segments end now; the next follow the previous one", () => {
    expect(
      segmentStartsOf({
        durationsS: [2, 2.5],
        nowMs: t0,
        firstOfRun: true,
        previousEndMs: undefined,
      }),
    ).toEqual([t0 - 4500, t0 - 2500])
    // Later polls of the same run: from the previous segment's end, whatever the clock says.
    expect(
      segmentStartsOf({
        durationsS: [2, 2],
        nowMs: t0 + 60_000,
        firstOfRun: false,
        previousEndMs: t0,
      }),
    ).toEqual([t0, t0 + 2000])
  })

  test("a restart leaves a gap, never an overlap with the stream's earlier segments", () => {
    // The upstream came back 10 s after the previous segment ended.
    expect(
      segmentStartsOf({ durationsS: [2], nowMs: t0 + 12_000, firstOfRun: true, previousEndMs: t0 }),
    ).toEqual([t0 + 10_000])
    // A provider bursting its buffer at the start would place it before: it starts at the end.
    expect(
      segmentStartsOf({
        durationsS: [2, 2, 2],
        nowMs: t0 + 3_000,
        firstOfRun: true,
        previousEndMs: t0,
      }),
    ).toEqual([t0, t0 + 2000, t0 + 4000])
  })

  test('a segment out of the window is deleted after its duration plus 30 s', () => {
    expect(expiredDeletionAt({ durationS: 2 }, t0)).toBe(t0 + 32_000)
    expect(expiredDeletionAt({ durationS: 3.5 }, t0)).toBe(t0 + 33_500)
  })

  test('the cache cap shortens the oldest window first, never below its newest 30 s', () => {
    const window = (startMs: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({
        startMs: startMs + i * 2000,
        durationS: 2,
        bytes: 100,
      }))
    const windows = new Map([
      // Started 10 minutes earlier than b: its oldest segments go first.
      ['a', window(t0, 40)],
      ['b', window(t0 + 600_000, 40)],
    ])
    expect(cacheTrimOf(windows, 8000)).toEqual(new Map())
    expect(cacheTrimOf(windows, 7000)).toEqual(new Map([['a', 10]]))
    // a down to its newest 30 s (15 segments), then b's oldest.
    expect(cacheTrimOf(windows, 4000)).toEqual(
      new Map([
        ['a', 25],
        ['b', 15],
      ]),
    )
    // Nothing below 30 s a stream: the cap stays exceeded rather than empty a window.
    expect(cacheTrimOf(windows, 0)).toEqual(
      new Map([
        ['a', 25],
        ['b', 25],
      ]),
    )
  })
})
