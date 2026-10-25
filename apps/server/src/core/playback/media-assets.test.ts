import { describe, expect, test } from 'bun:test'

import {
  isTextSubtitle,
  previewWindow,
  sameFingerprint,
  trickplayFrameAt,
  trickplayHeight,
} from './media-assets.ts'

describe('trickplayFrameAt', () => {
  const index = { interval: 10, width: 320, height: 180, columns: 10, rows: 10, sheets: [0, 1] }
  test('the thumbnail nearest to the second', () => {
    expect(trickplayFrameAt(index, 0)).toEqual({ sheet: 0, column: 0, row: 0 })
    expect(trickplayFrameAt(index, 54.9)).toEqual({ sheet: 0, column: 5, row: 0 })
    expect(trickplayFrameAt(index, 59.9)).toEqual({ sheet: 0, column: 6, row: 0 })
    expect(trickplayFrameAt(index, 123)).toEqual({ sheet: 0, column: 2, row: 1 })
  })
  test('the next sheet after 100 thumbnails, the last thumbnail past the end', () => {
    expect(trickplayFrameAt(index, 1000)).toEqual({ sheet: 1, column: 0, row: 0 })
    expect(trickplayFrameAt(index, 99_999)).toEqual({ sheet: 1, column: 9, row: 9 })
  })
  test('a negative second is the first thumbnail, no sheet means none', () => {
    expect(trickplayFrameAt(index, -5)).toEqual({ sheet: 0, column: 0, row: 0 })
    expect(trickplayFrameAt({ ...index, sheets: [] }, 5)).toBeUndefined()
  })
})

describe('trickplayHeight (scale=320:-2)', () => {
  test.each([
    [{ width: 1920, height: 1080 }, 180],
    [{ width: 3840, height: 1600 }, 134],
    [{ width: 720, height: 576 }, 256],
    [{ width: 160, height: 90 }, 180],
    [{}, 180],
    [{ width: 0, height: 0 }, 180],
  ])('%p → %p (even)', (video, expected) => {
    expect(trickplayHeight(video)).toBe(expected)
    expect(trickplayHeight(video) % 2).toBe(0)
  })
})

describe('previewWindow (§13.3: 20 s from 25 %)', () => {
  test('a movie: 20 s from a quarter of the duration', () => {
    expect(previewWindow(2 * 60 * 60_000)).toEqual({ startS: 1800, durationS: 20 })
  })
  test('a short file: kept inside it', () => {
    expect(previewWindow(30_000)).toEqual({ startS: 7.5, durationS: 20 })
    expect(previewWindow(24_000)).toEqual({ startS: 4, durationS: 20 })
    expect(previewWindow(10_000)).toEqual({ startS: 0, durationS: 10 })
  })
})

test('text subtitle formats are the ones sent as WebVTT (§10.4)', () => {
  expect(['srt', 'ass', 'ssa', 'vtt', 'mov_text'].every(isTextSubtitle)).toBe(true)
  expect(['pgs', 'vobsub', 'dvb', 'unknown'].some(isTextSubtitle)).toBe(false)
})

test('fingerprints compare size and mtime strictly', () => {
  expect(sameFingerprint({ sizeBytes: 1, mtimeMs: 2.5 }, { sizeBytes: 1, mtimeMs: 2.5 })).toBe(true)
  expect(sameFingerprint({ sizeBytes: 1, mtimeMs: 2.5 }, { sizeBytes: 1, mtimeMs: 2.6 })).toBe(
    false,
  )
})
