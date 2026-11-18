import { describe, expect, test } from 'bun:test'

import { livePointOf, mediaTimeAt, nativeMediaTimeAt } from './live-position.ts'

const t0 = Date.parse('2026-11-18T20:00:00.000Z')

describe('timeshift in the <video> (§29.5)', () => {
  // Two fragments, a 10 s restart gap, then two more: hls.js places them end to end.
  const fragments = [
    { start: 100, duration: 2, dateMs: t0 },
    { start: 102, duration: 2, dateMs: t0 + 2000 },
    { start: 104, duration: 2, dateMs: t0 + 14_000 },
    { start: 106, duration: 2, dateMs: t0 + 16_000 },
  ]

  test("maps a wall-clock time through the fragments' program dates", () => {
    expect(mediaTimeAt(fragments, t0 + 500)).toBe(100.5)
    expect(mediaTimeAt(fragments, t0 + 3000)).toBe(103)
    expect(mediaTimeAt(fragments, t0 + 15_000)).toBe(105)
    // In the gap: the first fragment after it. Before the window: its start. Past it: its end.
    expect(mediaTimeAt(fragments, t0 + 8000)).toBe(104)
    expect(mediaTimeAt(fragments, t0 - 60_000)).toBe(100)
    expect(mediaTimeAt(fragments, t0 + 99_000)).toBe(108)
    expect(mediaTimeAt([{ start: 0, duration: 2, dateMs: undefined }], t0)).toBeUndefined()
  })

  test('native HLS maps through the start date, within what is seekable', () => {
    expect(nativeMediaTimeAt(t0, t0 + 30_000, { start: 10, end: 60 })).toBe(30)
    expect(nativeMediaTimeAt(t0, t0, { start: 10, end: 60 })).toBe(10)
    expect(nativeMediaTimeAt(t0, t0 + 99_000, { start: 10, end: 60 })).toBe(60)
  })

  test('the live point is 6 s before the end of what can be played', () => {
    expect(livePointOf(1800)).toBe(1794)
    expect(livePointOf(3)).toBe(0)
  })
})
