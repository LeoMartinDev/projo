import { describe, expect, test } from 'bun:test'

import { KEYFRAME_WAIT_RETRIES } from '@projo/player/core/playlist-wait'

import { keyframeWaitLoadPolicy, mediaPlaylistUrl } from './playlist.ts'

describe('native HLS: the playlist the wait asks (§10.3)', () => {
  test('the media playlist beside master.m3u8', () => {
    expect(
      mediaPlaylistUrl(
        '/api/v1/stream/s/k/master.m3u8?subtitleOffsetMs=200',
        'https://h.example/watch/1',
      ),
    ).toBe('https://h.example/api/v1/stream/s/k/index.m3u8')
  })
})

describe('hls.js: waiting for the keyframe index (§10.3)', () => {
  const policy = keyframeWaitLoadPolicy.default
  const retries = (code: number, retryCount: number) =>
    policy.errorRetry?.shouldRetry?.(
      policy.errorRetry,
      retryCount,
      false,
      { code, text: '', url: '' },
      true,
    )

  test('index.m3u8 held by the server while it indexes is not a timeout', () => {
    const serverWaitMs = 20_000
    expect(policy.maxTimeToFirstByteMs).toBeGreaterThan(serverWaitMs)
    expect(policy.maxLoadTimeMs).toBeGreaterThan(serverWaitMs)
  })

  test('a 503 is asked again, as many times as the native wait', () => {
    expect(policy.errorRetry?.maxNumRetry).toBe(KEYFRAME_WAIT_RETRIES)
    expect(retries(503, 0)).toBe(true)
    expect(retries(503, KEYFRAME_WAIT_RETRIES - 1)).toBe(true)
  })

  test('another error is asked again once, then fails', () => {
    expect(retries(404, 0)).toBe(true)
    expect(retries(404, 1)).toBe(false)
  })
})
