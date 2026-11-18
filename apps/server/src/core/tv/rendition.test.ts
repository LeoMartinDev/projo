import { describe, expect, test } from 'bun:test'

import type { ClientCapabilities } from '@projo/shared/api/playback'

import type { TvChannelProbe } from './live.ts'
import { isInterlaced, liveRenditionOf } from './rendition.ts'

const chrome: ClientCapabilities = {
  videoCodecs: ['avc1', 'vp09', 'av01'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}
const safari: ClientCapabilities = {
  videoCodecs: ['avc1', 'hvc1'],
  audioCodecs: ['mp4a.40.2', 'ac-3', 'ec-3'],
  hls: 'native',
  engine: 'browser',
}
const desktop: ClientCapabilities = {
  videoCodecs: ['avc1', 'hvc1', 'av01', 'vp09'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'native',
  engine: 'mpv',
}

const probe = (video: Partial<TvChannelProbe['video']> = {}): TvChannelProbe => ({
  video: { codec: 'h264', profile: 'High', pixelFormat: 'yuv420p', ...video },
  audio: [{ index: 1, codec: 'aac', audioDescription: false }],
})

describe('liveRenditionOf (§29.4)', () => {
  test('a progressive codec the browser decodes is copied', () => {
    expect(liveRenditionOf(probe(), chrome)).toBe('copy')
    expect(liveRenditionOf(probe({ fieldOrder: 'progressive' }), chrome)).toBe('copy')
    expect(liveRenditionOf(probe({ codec: 'hevc' }), safari)).toBe('copy')
    expect(liveRenditionOf(probe({ codec: 'vp9' }), chrome)).toBe('copy')
    expect(liveRenditionOf(probe({ codec: 'av1' }), chrome)).toBe('copy')
  })

  test('a codec the browser does not decode is transcoded', () => {
    expect(liveRenditionOf(probe({ codec: 'hevc' }), chrome)).toBe('compat')
    expect(liveRenditionOf(probe({ codec: 'mpeg2video' }), safari)).toBe('compat')
    expect(liveRenditionOf(probe({ codec: 'av1' }), safari)).toBe('compat')
  })

  test('H.264 a browser cannot decode (10-bit, 4:2:2) is transcoded', () => {
    expect(liveRenditionOf(probe({ profile: 'High 10', pixelFormat: 'yuv420p10le' }), chrome)).toBe(
      'compat',
    )
    expect(liveRenditionOf(probe({ profile: 'High 4:2:2', pixelFormat: 'yuv422p' }), chrome)).toBe(
      'compat',
    )
    expect(liveRenditionOf(probe({ pixelFormat: 'yuvj420p' }), chrome)).toBe('copy')
  })

  test('interlaced video is transcoded for a browser, whatever its codec', () => {
    for (const fieldOrder of ['tt', 'bb', 'tb', 'bt']) {
      expect(liveRenditionOf(probe({ fieldOrder }), chrome)).toBe('compat')
      expect(liveRenditionOf(probe({ fieldOrder, codec: 'hevc' }), safari)).toBe('compat')
    }
    expect(liveRenditionOf(probe({ fieldOrder: 'unknown' }), chrome)).toBe('copy')
  })

  test('the mpv engine always gets the copy, probed or not', () => {
    expect(liveRenditionOf(probe({ fieldOrder: 'tt', codec: 'mpeg2video' }), desktop)).toBe('copy')
    expect(liveRenditionOf(undefined, desktop)).toBe('copy')
  })

  test('a browser without a probe waits for one', () => {
    expect(liveRenditionOf(undefined, chrome)).toBeUndefined()
    expect(liveRenditionOf(undefined, safari)).toBeUndefined()
  })

  test('isInterlaced reads the field order', () => {
    expect(isInterlaced({ codec: 'h264', fieldOrder: 'tt' })).toBe(true)
    expect(isInterlaced({ codec: 'h264', fieldOrder: 'progressive' })).toBe(false)
    expect(isInterlaced({ codec: 'h264' })).toBe(false)
  })
})
