import { describe, expect, test } from 'bun:test'

import { mediaPlaylistUrl, waitForPlaylist } from './playlist-wait.ts'

const answers = (...statuses: number[]) => {
  const asked: number[] = []
  return {
    asked,
    status: async () => {
      const next = statuses.shift() ?? 200
      asked.push(next)
      return next
    },
  }
}

describe('native HLS: waiting for the keyframe index (§10.3)', () => {
  test('asks again while the server answers 503, then hands over', async () => {
    const server = answers(503, 503, 200)
    const delays: number[] = []
    const result = await waitForPlaylist({
      status: server.status,
      delay: async (ms) => void delays.push(ms),
      cancelled: () => false,
    })
    expect(result).toBe('ready')
    expect(server.asked).toEqual([503, 503, 200])
    expect(delays).toEqual([1000, 2000])
  })

  test('another error or no answer hands over at once: the native player reports it', async () => {
    for (const status of [404, 0, 410]) {
      const server = answers(status)
      expect(
        await waitForPlaylist({
          status: server.status,
          delay: async () => {},
          cancelled: () => false,
        }),
      ).toBe('ready')
      expect(server.asked).toHaveLength(1)
    }
  })

  test('the same budget as hls.js: 15 retries, then the stream fails as before', async () => {
    const server = answers(...Array.from({ length: 30 }, () => 503))
    await waitForPlaylist({ status: server.status, delay: async () => {}, cancelled: () => false })
    expect(server.asked).toHaveLength(16)
  })

  test('a detached stream stops asking', async () => {
    const server = answers(503, 503, 503)
    let gone = false
    const result = await waitForPlaylist({
      status: server.status,
      delay: async () => {
        gone = true
      },
      cancelled: () => gone,
    })
    expect(result).toBe('cancelled')
    expect(server.asked).toHaveLength(1)
  })

  test('the media playlist beside master.m3u8', () => {
    expect(
      mediaPlaylistUrl(
        '/api/v1/stream/s/k/master.m3u8?subtitleOffsetMs=200',
        'https://h.example/watch/1',
      ),
    ).toBe('https://h.example/api/v1/stream/s/k/index.m3u8')
  })
})
