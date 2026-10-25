import { describe, expect, test } from 'bun:test'

import type { ItemSegmentsDto } from '@projo/shared/api/segments'

import {
  checkDraft,
  draftOf,
  hasManualMarkers,
  isDirty,
  markerStateOf,
  spanGeometry,
  timelineLengthOf,
} from './markers.ts'

const dto: ItemSegmentsDto = {
  itemId: 'e1',
  durationMs: 1_500_000,
  segments: [
    { type: 'intro', startMs: 42_000, endMs: 92_000, origin: 'theintrodb', confidence: 0.9 },
    { type: 'credits', startMs: 1_420_000, endMs: 1_500_000, origin: 'manual' },
  ],
  absent: ['recap'],
  lookups: [],
}

describe('markerStateOf', () => {
  test('a segment, a negative marker or nothing', () => {
    expect(markerStateOf(dto, 'intro')).toMatchObject({ kind: 'segment' })
    expect(markerStateOf(dto, 'recap')).toEqual({ kind: 'absent' })
    expect(markerStateOf(dto, 'preview')).toEqual({ kind: 'empty' })
  })

  test('the fields start from the stored segment', () => {
    expect(draftOf(markerStateOf(dto, 'intro'))).toEqual({ start: '0:42', end: '1:32' })
    expect(draftOf({ kind: 'absent' })).toEqual({ start: '', end: '' })
  })
})

describe('checkDraft', () => {
  test('valid inside the duration', () => {
    expect(checkDraft({ start: '0:42', end: '1:32' }, 1_500_000)).toEqual({
      ok: true,
      startMs: 42_000,
      endMs: 92_000,
    })
  })

  test('names what is wrong', () => {
    expect(checkDraft({ start: '', end: '1:00' }, undefined)).toEqual({
      ok: false,
      error: 'incomplete',
    })
    expect(checkDraft({ start: '1:75', end: '2:00' }, undefined)).toMatchObject({
      error: 'start_invalid',
    })
    expect(checkDraft({ start: '1:00', end: 'x' }, undefined)).toMatchObject({
      error: 'end_invalid',
    })
    expect(checkDraft({ start: '1:00', end: '1:00' }, undefined)).toMatchObject({ error: 'order' })
    expect(checkDraft({ start: '24:00', end: '26:00' }, 1_500_000)).toMatchObject({
      error: 'beyond',
    })
  })

  test('an end shown rounded up past the end of file stays the end of file', () => {
    // 2 640 160 ms is shown `44:00.2`, which parses to 2 640 200.
    expect(checkDraft({ start: '42:00', end: '44:00.2' }, 2_640_160)).toEqual({
      ok: true,
      startMs: 2_520_000,
      endMs: 2_640_160,
    })
    expect(checkDraft({ start: '42:00', end: '44:00.3' }, 2_640_160)).toMatchObject({
      error: 'beyond',
    })
  })
})

describe('isDirty', () => {
  const intro = markerStateOf(dto, 'intro')

  test('untouched fields are not an edit, even with a position shown rounded', () => {
    expect(isDirty(intro, checkDraft(draftOf(intro), dto.durationMs))).toBe(false)
    const precise = {
      kind: 'segment' as const,
      segment: {
        type: 'intro' as const,
        startMs: 42_049,
        endMs: 92_010,
        origin: 'skipdb' as const,
      },
    }
    expect(isDirty(precise, checkDraft(draftOf(precise), undefined))).toBe(false)
  })

  test('a changed or new marker is', () => {
    expect(isDirty(intro, checkDraft({ start: '0:40', end: '1:32' }, undefined))).toBe(true)
    expect(isDirty({ kind: 'empty' }, checkDraft({ start: '0:10', end: '0:20' }, undefined))).toBe(
      true,
    )
    expect(isDirty({ kind: 'empty' }, checkDraft({ start: '0:10', end: '' }, undefined))).toBe(
      false,
    )
  })
})

describe('timeline', () => {
  test('the duration, else the furthest end', () => {
    expect(timelineLengthOf(1_500_000, [{ endMs: 10 }])).toBe(1_500_000)
    expect(timelineLengthOf(undefined, [{ endMs: 10_000 }, { endMs: 90_000 }])).toBe(90_000)
    expect(timelineLengthOf(undefined, [])).toBeUndefined()
  })

  test('spans in percent, clamped to the bar', () => {
    expect(spanGeometry({ startMs: 250, endMs: 500 }, 1_000)).toEqual({ left: 25, width: 25 })
    expect(spanGeometry({ startMs: 900, endMs: 1_400 }, 1_000)).toEqual({ left: 90, width: 10 })
  })
})

test('only manual and negative markers go to the season', () => {
  expect(hasManualMarkers(dto)).toBe(true)
  expect(
    hasManualMarkers({
      ...dto,
      absent: [],
      segments: dto.segments.filter((s) => s.type === 'intro'),
    }),
  ).toBe(false)
})
