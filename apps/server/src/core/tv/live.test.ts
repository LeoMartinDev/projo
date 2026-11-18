import { describe, expect, test } from 'bun:test'

import { isLiveFileName, liveAudioOf, upstreamHostOf } from './live.ts'

describe('the relay rules (§29.4)', () => {
  test('relays the first track that is not an audio description, copied when AAC', () => {
    const video = { codec: 'h264' }
    expect(liveAudioOf({ video, audio: [] })).toBeUndefined()
    expect(
      liveAudioOf({
        video,
        audio: [
          { index: 3, codec: 'aac', audioDescription: true },
          { index: 4, codec: 'ac3', audioDescription: false },
          { index: 5, codec: 'aac', audioDescription: false },
        ],
      }),
    ).toEqual({ index: 4, copy: false })
    expect(
      liveAudioOf({ video, audio: [{ index: 1, codec: 'aac', audioDescription: true }] }),
    ).toEqual({ index: 1, copy: true })
  })

  test('serves only init and segment names', () => {
    expect(isLiveFileName('init-2.mp4')).toBe(true)
    expect(isLiveFileName('seg-2-00041.m4s')).toBe(true)
    expect(isLiveFileName('seg-2-100041.m4s')).toBe(true)
    for (const name of ['run-1.m3u8', '../init-1.mp4', 'init-1.mp4/x', 'seg-1-1.m4s', '']) {
      expect(isLiveFileName(name)).toBe(false)
    }
  })

  test('logs name an upstream by its scheme and host only', () => {
    expect(upstreamHostOf('http://user:pass@iptv.example:8080/live/u/p/1.ts?token=x')).toBe(
      'http://iptv.example:8080',
    )
    expect(upstreamHostOf('RTSP://mafreebox.freebox.fr/fbxtv_pub/stream?id=1')).toBe(
      'rtsp://mafreebox.freebox.fr',
    )
    expect(upstreamHostOf('not a url')).toBe('unknown')
  })
})
