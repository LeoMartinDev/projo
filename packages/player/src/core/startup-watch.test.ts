import { describe, expect, test } from 'bun:test'

import { decodeFallbackQuality } from './decode-fallback.ts'
import { startupFailure, startupStuck, startupTimeoutMs, watchesStartup } from './startup-watch.ts'

describe('startup watch (§10.7)', () => {
  test('only a video sent as is is watched', () => {
    expect(watchesStartup({ mode: 'direct' })).toBe(true)
    expect(watchesStartup({ mode: 'hls_remux' })).toBe(true)
    expect(watchesStartup({ mode: 'hls_transcode' })).toBe(false)
  })

  test('stuck unless the metadata is there and the media paused (waiting for the user)', () => {
    expect(startupStuck({ ready: false, paused: true })).toBe(true)
    expect(startupStuck({ ready: false, paused: false })).toBe(true)
    expect(startupStuck({ ready: true, paused: false })).toBe(true)
    expect(startupStuck({ ready: true, paused: true })).toBe(false)
  })

  test('a stuck start falls back like a decoding failure', () => {
    expect(startupTimeoutMs).toBe(15_000)
    expect(
      decodeFallbackQuality({
        failure: startupFailure,
        session: {
          mode: 'hls_remux',
          sourceId: 'dv',
          availableQualities: ['original', '1080p', '720p'],
        },
        fallenBack: new Set(),
      }),
    ).toBe('1080p')
  })
})
