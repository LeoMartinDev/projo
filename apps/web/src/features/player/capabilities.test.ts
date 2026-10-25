import { describe, expect, test } from 'bun:test'

import { detectCapabilities, hlsSupport, type MediaEnvironment } from './capabilities.ts'

const chromeLike = (overrides: Partial<MediaEnvironment> = {}): MediaEnvironment => ({
  isTypeSupported: (type) =>
    /avc1|vp09|av01|mp4a\.40\.2|opus|flac/.test(type) && !/hvc1|hev1|ac-3|ec-3/.test(type),
  canPlayType: () => '',
  hlsJsSupported: true,
  preferNativeHls: false,
  screenHeight: 2160,
  ...overrides,
})

describe('detectCapabilities', () => {
  test('lists what MediaSource accepts, in the fixed order', async () => {
    expect(await detectCapabilities(chromeLike())).toEqual({
      videoCodecs: ['avc1', 'av01', 'vp09'],
      audioCodecs: ['mp4a.40.2', 'opus', 'flac'],
      hls: 'mse',
      screenHeight: 2160,
    })
  })

  test('decodingInfo can veto a codec MediaSource accepts', async () => {
    const capabilities = await detectCapabilities(
      chromeLike({
        decodingInfo: async (configuration) => ({
          supported: !(configuration.video?.contentType.includes('av01') ?? false),
        }),
      }),
    )
    expect(capabilities.videoCodecs).toEqual(['avc1', 'vp09'])
    expect(capabilities.audioCodecs).toEqual(['mp4a.40.2', 'opus', 'flac'])
  })

  test('decodingInfo errors do not hide a supported codec', async () => {
    const capabilities = await detectCapabilities(
      chromeLike({ decodingInfo: () => Promise.reject(new TypeError('bad configuration')) }),
    )
    expect(capabilities.videoCodecs).toContain('avc1')
  })

  test('decodingInfo is asked about media-source playback when MSE exists', async () => {
    const types: string[] = []
    await detectCapabilities(
      chromeLike({
        decodingInfo: async (configuration) => {
          types.push(configuration.type)
          return { supported: true }
        },
      }),
    )
    expect(new Set(types)).toEqual(new Set(['media-source']))
  })

  test('without MSE, canPlayType decides (old iOS Safari)', async () => {
    const capabilities = await detectCapabilities({
      canPlayType: (type) => (/avc1|hvc1|mp4a|ec-3|ac-3|mpegurl/.test(type) ? 'probably' : ''),
      hlsJsSupported: false,
      preferNativeHls: true,
    })
    expect(capabilities).toEqual({
      videoCodecs: ['avc1', 'hvc1'],
      audioCodecs: ['mp4a.40.2', 'ec-3', 'ac-3'],
      hls: 'native',
    })
  })

  test('falls back to the second probe of a codec (hev1)', async () => {
    const capabilities = await detectCapabilities(
      chromeLike({ isTypeSupported: (type) => type.includes('hev1') }),
    )
    expect(capabilities.videoCodecs).toEqual(['hvc1'])
  })
})

describe('hlsSupport', () => {
  const env = (canHls: boolean, hlsJs: boolean, apple: boolean): MediaEnvironment => ({
    canPlayType: (type) => (canHls && type.includes('mpegurl') ? 'maybe' : ''),
    hlsJsSupported: hlsJs,
    preferNativeHls: apple,
  })

  test('Safari plays HLS natively even with MSE', () => {
    expect(hlsSupport(env(true, true, true))).toBe('native')
  })

  test('elsewhere hls.js wins over a native player', () => {
    expect(hlsSupport(env(true, true, false))).toBe('mse')
    expect(hlsSupport(env(false, true, false))).toBe('mse')
  })

  test('native without hls.js, none without either', () => {
    expect(hlsSupport(env(true, false, false))).toBe('native')
    expect(hlsSupport(env(false, false, false))).toBe('none')
  })
})
