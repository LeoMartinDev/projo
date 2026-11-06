import { describe, expect, test } from 'bun:test'

import {
  isTextSubtitle,
  previewWindow,
  sameFingerprint,
  trickplayHeight,
  trickplayInstantAt,
  trickplayThumbnailTimes,
} from './media-assets.ts'

describe('trickplayThumbnailTimes', () => {
  const spec = { intervalS: 10, durationS: 45 }

  test('each thumbnail shows the last decoded frame at or before its instant', () => {
    expect(trickplayThumbnailTimes([0, 10.427, 20.854, 31.281, 41.708], spec)).toEqual([
      0, 0, 10.427, 20.854, 31.281,
    ])
    expect(trickplayThumbnailTimes([20, 0, 10, 30, 40], spec)).toEqual([0, 10, 20, 30, 40])
  })

  test('a long GOP repeats its keyframe, a first frame after 0 opens the sprites', () => {
    expect(trickplayThumbnailTimes([0.042, 15.015, 30.03], spec)).toEqual([
      0.042, 0.042, 15.015, 15.015, 30.03,
    ])
  })

  test('frames from the end on are cut like the sprites, none means unknown', () => {
    expect(trickplayThumbnailTimes([0, 44, 46], spec)).toEqual([0, 0, 0, 0, 0])
    expect(trickplayThumbnailTimes([0], { intervalS: 10, durationS: 5 })).toEqual([0])
    expect(trickplayThumbnailTimes([], spec)).toBeUndefined()
    expect(trickplayThumbnailTimes([50], spec)).toBeUndefined()
  })
})

describe('trickplayInstantAt', () => {
  const index = { interval: 10, width: 320, height: 180, columns: 10, rows: 10, sheets: [0, 1] }
  test('the thumbnail nearest to the second', () => {
    expect(trickplayInstantAt(index, 0, 3600)).toBe(0)
    expect(trickplayInstantAt(index, 54.9, 3600)).toBe(50)
    expect(trickplayInstantAt(index, 59.9, 3600)).toBe(60)
    expect(trickplayInstantAt(index, 1234, 3600)).toBe(1230)
  })
  test('the last started interval past the end', () => {
    expect(trickplayInstantAt(index, 99_999, 3605)).toBe(3600)
    expect(trickplayInstantAt(index, 99_999, 3600)).toBe(3590)
  })
  test('a negative second is the first thumbnail, no sheet means none', () => {
    expect(trickplayInstantAt(index, -5, 3600)).toBe(0)
    expect(trickplayInstantAt({ ...index, sheets: [] }, 5, 3600)).toBeUndefined()
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
