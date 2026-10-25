import { describe, expect, test } from 'bun:test'

import { bestQuality, resolutionOf } from './catalog.ts'

describe('best quality ("4K HDR")', () => {
  test('resolution first, then dynamic range', () => {
    expect(
      bestQuality([
        { resolution: '1080p', dynamicRange: 'dv' },
        { resolution: '2160p', dynamicRange: 'sdr' },
        { resolution: '2160p', dynamicRange: 'hdr' },
        { resolution: '720p', dynamicRange: 'sdr' },
      ]),
    ).toEqual({ resolution: '2160p', dynamicRange: 'hdr' })
    expect(bestQuality([])).toBeUndefined()
  })

  test('resolution classes follow the width for scope formats', () => {
    expect(resolutionOf(3840, 1600)).toBe('2160p')
    expect(resolutionOf(1920, 800)).toBe('1080p')
    expect(resolutionOf(1280, 534)).toBe('720p')
    expect(resolutionOf(720, 576)).toBe('SD')
    expect(resolutionOf(undefined, undefined)).toBeUndefined()
  })
})
