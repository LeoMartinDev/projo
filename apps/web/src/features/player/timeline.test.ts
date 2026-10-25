import { describe, expect, test } from 'bun:test'

import {
  chapterIndexAt,
  chaptersOnItem,
  currentPart,
  currentPartDurationMs,
  itemPositionMs,
  nextPart,
  ratioAtPointer,
  remainingMs,
  seekTargetFor,
  segmentAt,
  segmentZones,
  type TimelineSession,
  totalDurationMs,
} from './timeline.ts'

const part = (index: number, offsetMs: number, durationMs: number) => ({
  sourceId: `cd${index + 1}`,
  index,
  offsetMs,
  durationMs,
})

/** A movie in two parts of 50 and 40 minutes, the second one playing. */
const stacked: TimelineSession = {
  sourceId: 'cd2',
  durationMs: 5_400_000,
  parts: [part(1, 3_000_000, 2_400_000), part(0, 0, 3_000_000)],
  partOffsetMs: 3_000_000,
}

const single: TimelineSession = {
  sourceId: 'a',
  durationMs: 2_832_000,
  parts: [{ sourceId: 'a', index: 0, offsetMs: 0, durationMs: 2_832_000 }],
  partOffsetMs: 0,
}

describe('parts', () => {
  test('the current part is the streamed source, the next one follows by index', () => {
    expect(currentPart(stacked)?.sourceId).toBe('cd2')
    expect(nextPart(stacked)).toBeUndefined()
    expect(nextPart({ ...stacked, sourceId: 'cd1', partOffsetMs: 0 })?.sourceId).toBe('cd2')
    expect(nextPart(single)).toBeUndefined()
  })

  test('positions are cumulative: the stream starts at 0 at the part offset', () => {
    expect(itemPositionMs(stacked, 12.5)).toBe(3_012_500)
    expect(itemPositionMs(single, Number.NaN)).toBe(0)
  })

  test('the total is the longest of the DTO duration, the parts and the stream', () => {
    expect(totalDurationMs(stacked, 2_400_000)).toBe(5_400_000)
    const placeholder = {
      ...single,
      durationMs: undefined,
      parts: [{ ...single.parts[0]!, durationMs: 0 }],
    }
    expect(totalDurationMs(placeholder, 61_000)).toBe(61_000)
    expect(currentPartDurationMs(placeholder, 61_000)).toBe(61_000)
  })
})

describe('seekTargetFor', () => {
  test('inside the current part, the stream seeks', () => {
    expect(seekTargetFor(stacked, 2_400_000, 3_600_000)).toEqual({ kind: 'stream', seconds: 600 })
    expect(seekTargetFor(single, 0, 99_999_999)).toEqual({ kind: 'stream', seconds: 2832 })
  })

  test('in another part, a new session starts there', () => {
    expect(seekTargetFor(stacked, 2_400_000, 1_000_000)).toEqual({
      kind: 'part',
      part: part(0, 0, 3_000_000),
      positionMs: 1_000_000,
    })
  })
})

describe('bar', () => {
  test('remaining time and pointer ratio are clamped', () => {
    expect(remainingMs(46_000, 2_832_000)).toBe(2_786_000)
    expect(remainingMs(3_000_000, 2_832_000)).toBe(0)
    expect(ratioAtPointer(150, { left: 100, width: 200 })).toBe(0.25)
    expect(ratioAtPointer(20, { left: 100, width: 200 })).toBe(0)
    expect(ratioAtPointer(20, { left: 0, width: 0 })).toBe(0)
  })

  test('segments become zones, empty or reversed ones are dropped', () => {
    expect(
      segmentZones(
        [
          { type: 'intro', startMs: 28_320, endMs: 99_120 },
          { type: 'credits', startMs: 2_718_720, endMs: 2_832_000 },
          { type: 'recap', startMs: 10, endMs: 10 },
        ],
        2_832_000,
      ),
    ).toEqual([
      { type: 'intro', left: 0.01, width: 0.025 },
      { type: 'credits', left: 0.96, width: expect.closeTo(0.04, 6) as unknown as number },
    ])
    expect(segmentZones([{ type: 'intro', startMs: 0, endMs: 10 }], 0)).toEqual([])
  })

  test('the segment at a position is the one containing it', () => {
    const segments = [{ type: 'intro' as const, startMs: 1000, endMs: 5000 }]
    expect(segmentAt(segments, 4999)?.type).toBe('intro')
    expect(segmentAt(segments, 5000)).toBeUndefined()
  })
})

describe('chapters', () => {
  test('move onto the item timeline, sorted; the current one is the last started', () => {
    const chapters = chaptersOnItem(
      [
        { startMs: 600_000, endMs: 1_200_000, title: 'B' },
        { startMs: 0, endMs: 600_000, title: 'A' },
      ],
      3_000_000,
    )
    expect(chapters.map((chapter) => chapter.startMs)).toEqual([3_000_000, 3_600_000])
    expect(chapterIndexAt(chapters, 3_700_000)).toBe(1)
    expect(chapterIndexAt(chapters, 10)).toBe(-1)
  })
})
