import { describe, expect, test } from 'bun:test'

import { isMediaApiPath, isMediaPath, isStreamPath } from './media-paths.ts'

describe('media paths (§20)', () => {
  test('images, previews, trickplay, admin TMDB posters and channel logos are media routes', () => {
    for (const path of [
      '/images/0190c0de-0000-7000-8000-000000000001',
      '/previews/0190c0de-0000-7000-8000-000000000001.mp4',
      '/trickplay/source-1/index.json',
      '/trickplay/source-1/0.jpg',
      '/trickplay/source-1/frames/12.webp',
      '/admin/tmdb/posters/abc.jpg',
      '/tv/channels/0190c0de-0000-7000-8000-000000000001/logo',
      '/tv/channels/0190c0de-0000-7000-8000-000000000001/snapshot',
      '/tv/programmes/0190c0de-0000-7000-8000-000000000002/image',
    ]) {
      expect(isMediaApiPath(path)).toBe(true)
      expect(isMediaPath(`/api/v1${path}`)).toBe(true)
    }
  })

  test('nothing else, nor a path that only looks like one', () => {
    for (const path of [
      '/admin/images/optimize',
      '/imagesx/1',
      '/images',
      '/auth/me',
      '/admin/items/1/images/alternatives',
      '/stream/s1/secret/direct',
      '/images/../auth/me',
      '/images/./1',
      '/images/%2e%2e/auth/me',
      '/images/1%2F..%2F..%2Fauth%2Fme',
      '/tv/channels',
      '/tv/channels/1/logo/x',
      '/tv/channels/1/snapshot/x',
      '/tv/channels/1/snapshots',
      '/tv/channels/1/sessions',
      '/tv/programmes/1',
      '/tv/programmes/1/image/x',
    ]) {
      expect(isMediaApiPath(path)).toBe(false)
    }
    expect(isMediaPath('/images/1')).toBe(false)
    expect(isMediaPath('/api/v2/images/1')).toBe(false)
  })

  test('stream capability URLs, under the API prefix only', () => {
    expect(isStreamPath('/api/v1/stream/s1/secret/master.m3u8')).toBe(true)
    expect(isStreamPath('/api/v1/streams/x')).toBe(false)
    expect(isStreamPath('/stream/s1/secret/direct')).toBe(false)
  })
})
