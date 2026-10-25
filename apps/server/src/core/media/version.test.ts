import { describe, expect, test } from 'bun:test'

import { resolutionOf, sourceVersionOf } from './version.ts'

describe('sourceVersionOf (§7.7)', () => {
  test('codes from the main video stream and the parsed edition', () => {
    expect(
      sourceVersionOf(
        { codec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr' },
        { edition: 'directors_cut' },
      ),
    ).toEqual({
      resolution: '2160p',
      dynamicRange: 'hdr',
      videoCodec: 'hevc',
      edition: 'directors_cut',
    })
  })

  test.each([
    [{ codec: 'h264', width: 1920, height: 800, dynamicRange: 'sdr' as const }, '1080p' as const],
    [{ codec: 'av1', width: 3840, height: 1604, dynamicRange: 'dv' as const }, '2160p' as const],
    [{ codec: 'mpeg2video', width: 720, height: 576 }, 'SD' as const],
  ])('%p → %s', (video, resolution) => {
    expect(sourceVersionOf(video, {}).resolution).toBe(resolution)
  })

  test('a tag keeps its text; unknown codec and missing probe give nothing', () => {
    expect(sourceVersionOf({ codec: 'HEVC' }, { editionName: 'Cut 4K' })).toEqual({
      videoCodec: 'hevc',
      editionName: 'Cut 4K',
    })
    expect(sourceVersionOf({ codec: 'unknown' }, {})).toEqual({})
    expect(sourceVersionOf(undefined, { edition: 'imax' })).toEqual({ edition: 'imax' })
  })

  test('resolution classes', () => {
    expect(resolutionOf(undefined, undefined)).toBeUndefined()
    expect(resolutionOf(1440, 1080)).toBe('1080p')
    expect(resolutionOf(1280, 720)).toBe('720p')
    expect(resolutionOf(640, 480)).toBe('SD')
  })
})
