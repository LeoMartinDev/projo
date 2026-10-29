import { describe, expect, test } from 'bun:test'

import type { ClientCapabilities } from '@projo/shared/api/playback'

import {
  availableQualities,
  decidePlayback,
  effectiveQuality,
  videoCodecId,
} from './decide-mode.ts'
import type { AudioStreamInfo, MediaInfo } from './media-info.ts'

const chrome: ClientCapabilities = {
  videoCodecs: ['avc1', 'vp09', 'av01', 'hvc1'],
  audioCodecs: ['mp4a.40.2', 'opus', 'flac'],
  hls: 'mse',
}
const safari: ClientCapabilities = {
  videoCodecs: ['avc1', 'hvc1'],
  audioCodecs: ['mp4a.40.2', 'ac-3', 'ec-3', 'flac'],
  hls: 'native',
}
const oldChrome: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}

const audio = (
  index: number,
  codec: string,
  extra: Partial<AudioStreamInfo> = {},
): AudioStreamInfo => ({
  index,
  codec,
  isDefault: false,
  ...extra,
})

const media = (
  videoCodec: string,
  audios: AudioStreamInfo[],
  extra: Partial<MediaInfo> = {},
): MediaInfo => ({
  video: [{ index: 0, codec: videoCodec, pixelFormat: 'yuv420p' }],
  audio: audios,
  subtitles: [],
  ...extra,
})

const decide = (input: {
  media: MediaInfo
  extension: string
  capabilities: ClientCapabilities
  audioStreamIndex?: number
  quality?: 'original' | '1080p' | '720p' | '480p'
  burnIn?: boolean
  textSubtitle?: boolean
}) => decidePlayback({ quality: 'original', ...input })

describe('decidePlayback (§10.2)', () => {
  test('MP4 H.264 + AAC: direct', () => {
    const result = decide({
      media: media('h264', [audio(1, 'aac')]),
      extension: 'mp4',
      capabilities: chrome,
    })
    expect(result).toMatchObject({ ok: true, value: { mode: 'direct', mimeType: 'video/mp4' } })
  })

  test('MKV H.264 + AAC: HLS remux, audio copied', () => {
    const result = decide({
      media: media('h264', [audio(1, 'aac')]),
      extension: 'mkv',
      capabilities: chrome,
    })
    expect(result).toMatchObject({
      ok: true,
      value: {
        mode: 'hls_remux',
        videoCodec: 'avc1',
        audio: { stream: { index: 1 }, delivery: 'copy' },
      },
    })
  })

  test('MKV H.264 + AC-3: AAC on Chrome, copied on Safari', () => {
    const file = media('h264', [audio(1, 'ac3')])
    expect(decide({ media: file, extension: 'mkv', capabilities: chrome })).toMatchObject({
      ok: true,
      value: { mode: 'hls_remux', audio: { delivery: 'aac' } },
    })
    expect(decide({ media: file, extension: 'mkv', capabilities: safari })).toMatchObject({
      ok: true,
      value: { mode: 'hls_remux', audio: { delivery: 'copy' } },
    })
  })

  test('MP4 with AC-3 audio: direct on Safari, remux with AAC on Chrome', () => {
    const file = media('h264', [audio(1, 'ac3')])
    expect(decide({ media: file, extension: 'mp4', capabilities: safari })).toMatchObject({
      ok: true,
      value: { mode: 'direct' },
    })
    expect(decide({ media: file, extension: 'mp4', capabilities: chrome })).toMatchObject({
      ok: true,
      value: { mode: 'hls_remux', audio: { delivery: 'aac' } },
    })
  })

  test('FLAC, DTS, TrueHD are transcoded to AAC in HLS even when the browser reads FLAC', () => {
    for (const codec of ['flac', 'dts', 'truehd', 'opus']) {
      expect(
        decide({ media: media('h264', [audio(1, codec)]), extension: 'mkv', capabilities: chrome }),
      ).toMatchObject({ ok: true, value: { audio: { delivery: 'aac' } } })
    }
  })

  test('the default audio track is chosen, an explicit one wins', () => {
    const file = media('h264', [audio(1, 'aac'), audio(2, 'ac3', { isDefault: true })])
    expect(decide({ media: file, extension: 'mkv', capabilities: chrome })).toMatchObject({
      value: { audio: { stream: { index: 2 } } },
    })
    expect(
      decide({ media: file, extension: 'mkv', capabilities: chrome, audioStreamIndex: 1 }),
    ).toMatchObject({ value: { audio: { stream: { index: 1 } } } })
  })

  test('MP4 whose chosen audio is not the first track needs HLS', () => {
    const file = media('h264', [audio(1, 'aac'), audio(2, 'aac')])
    expect(
      decide({ media: file, extension: 'mp4', capabilities: chrome, audioStreamIndex: 2 }),
    ).toMatchObject({ ok: true, value: { mode: 'hls_remux' } })
  })

  test('HEVC: remux where supported, transcode needed elsewhere', () => {
    const file = media('hevc', [audio(1, 'aac')])
    expect(decide({ media: file, extension: 'mkv', capabilities: safari })).toMatchObject({
      ok: true,
      value: { mode: 'hls_remux', videoCodec: 'hvc1' },
    })
    expect(decide({ media: file, extension: 'mkv', capabilities: oldChrome })).toMatchObject({
      ok: true,
      value: {
        mode: 'hls_transcode',
        quality: 'original',
        reasons: ['video_codec'],
        audio: { stream: { index: 1 }, delivery: 'aac' },
      },
    })
  })

  test('HEVC tagged hev1 in an MP4: remux (retagged hvc1); hvc1 or no tag known: direct', () => {
    const tagged = (codecTag?: string): MediaInfo => ({
      video: [
        {
          index: 0,
          codec: 'hevc',
          pixelFormat: 'yuv420p',
          ...(codecTag === undefined ? {} : { codecTag }),
        },
      ],
      audio: [audio(1, 'aac')],
      subtitles: [],
    })
    expect(decide({ media: tagged('hev1'), extension: 'mp4', capabilities: safari })).toMatchObject(
      { ok: true, value: { mode: 'hls_remux', videoCodec: 'hvc1' } },
    )
    for (const codecTag of ['hvc1', undefined]) {
      expect(
        decide({ media: tagged(codecTag), extension: 'mp4', capabilities: safari }),
      ).toMatchObject({ ok: true, value: { mode: 'direct' } })
    }
  })

  test('10-bit H.264 needs a transcode', () => {
    const file: MediaInfo = {
      video: [{ index: 0, codec: 'h264', profile: 'High 10', pixelFormat: 'yuv420p10le' }],
      audio: [],
      subtitles: [],
    }
    expect(videoCodecId(file.video[0] ?? { index: 0, codec: '' })).toBeUndefined()
    expect(decide({ media: file, extension: 'mkv', capabilities: chrome })).toMatchObject({
      ok: true,
      value: { mode: 'hls_transcode', reasons: ['video_codec'] },
    })
  })

  test('a lower quality is a transcode, audio in AAC even when it could be copied', () => {
    expect(
      decide({
        media: media('h264', [audio(1, 'aac')]),
        extension: 'mp4',
        capabilities: chrome,
        quality: '720p',
      }),
    ).toMatchObject({
      ok: true,
      value: {
        mode: 'hls_transcode',
        quality: '720p',
        reasons: ['quality'],
        audio: { delivery: 'aac' },
      },
    })
  })

  test('a burnt-in subtitle forces a transcode, at the original quality', () => {
    expect(
      decide({
        media: media('h264', [audio(1, 'aac')]),
        extension: 'mp4',
        capabilities: chrome,
        burnIn: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { mode: 'hls_transcode', quality: 'original', reasons: ['burn_in'] },
    })
    expect(
      decide({
        media: media('vp8', [audio(1, 'aac')]),
        extension: 'webm',
        capabilities: chrome,
        quality: '480p',
        burnIn: true,
      }),
    ).toMatchObject({ value: { reasons: ['video_codec', 'quality', 'burn_in'] } })
  })

  test('a transcode needs HLS on the client', () => {
    expect(
      decide({
        media: media('hevc', [audio(1, 'aac')]),
        extension: 'mp4',
        capabilities: { ...oldChrome, hls: 'none' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'playback/mode_unsupported' } })
  })

  test('a quality above the source is lowered to the best available one', () => {
    const small: MediaInfo = {
      video: [{ index: 0, codec: 'h264', width: 1280, height: 720, pixelFormat: 'yuv420p' }],
      audio: [],
      subtitles: [],
    }
    expect(
      decide({ media: small, extension: 'mp4', capabilities: chrome, quality: '1080p' }),
    ).toMatchObject({ value: { mode: 'hls_transcode', quality: '720p' } })
  })

  test('no HLS on the client and a MKV: unsupported', () => {
    expect(
      decide({
        media: media('h264', [audio(1, 'aac')]),
        extension: 'mkv',
        capabilities: { ...chrome, hls: 'none' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'playback/mode_unsupported' } })
  })

  test('no video stream: unsupported', () => {
    expect(
      decide({
        media: { video: [], audio: [audio(0, 'aac')], subtitles: [] },
        extension: 'mp4',
        capabilities: chrome,
      }),
    ).toMatchObject({ ok: false, error: { code: 'playback/mode_unsupported' } })
  })

  test('file without audio plays directly', () => {
    expect(
      decide({ media: media('h264', []), extension: 'm4v', capabilities: chrome }),
    ).toMatchObject({
      ok: true,
      value: { mode: 'direct' },
    })
  })
})

describe('qualities (§10.2)', () => {
  const video = (width: number | undefined, height: number | undefined) => ({
    index: 0,
    codec: 'h264',
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  })

  test('original plus the lower qualities not above the source height', () => {
    expect(availableQualities(video(3840, 2160))).toEqual(['original', '1080p', '720p', '480p'])
    expect(availableQualities(video(1920, 1080))).toEqual(['original', '1080p', '720p', '480p'])
    expect(availableQualities(video(1280, 720))).toEqual(['original', '720p', '480p'])
    expect(availableQualities(video(720, 576))).toEqual(['original', '480p'])
    expect(availableQualities(video(640, 360))).toEqual(['original'])
  })

  test('a scope film counts at its 16:9 height', () => {
    expect(availableQualities(video(1920, 800))).toEqual(['original', '1080p', '720p', '480p'])
    expect(availableQualities(video(1280, 534))).toEqual(['original', '720p', '480p'])
  })

  test('unknown size: every quality; no video: original only', () => {
    expect(availableQualities(video(undefined, undefined))).toEqual([
      'original',
      '1080p',
      '720p',
      '480p',
    ])
    expect(availableQualities(undefined)).toEqual(['original'])
  })

  test('effectiveQuality lowers what the source cannot give', () => {
    expect(effectiveQuality(video(1280, 720), '1080p')).toBe('720p')
    expect(effectiveQuality(video(640, 360), '480p')).toBe('original')
    expect(effectiveQuality(video(1920, 1080), '480p')).toBe('480p')
  })
})

describe('decidePlayback: subtitles inside the stream (§10.4)', () => {
  const file = media('h264', [audio(1, 'aac', { isDefault: true })])
  const iosWeb: ClientCapabilities = { ...safari, subtitleDelivery: 'hls' }

  test('a text subtitle never plays direct for an `hls` client: remux carries the renditions', () => {
    expect(
      decide({ media: file, extension: 'mp4', capabilities: iosWeb, textSubtitle: true }),
    ).toMatchObject({ ok: true, value: { mode: 'hls_remux' } })
  })

  test('without subtitles, or for an overlay client, direct play stays', () => {
    expect(decide({ media: file, extension: 'mp4', capabilities: iosWeb })).toMatchObject({
      value: { mode: 'direct' },
    })
    expect(
      decide({ media: file, extension: 'mp4', capabilities: safari, textSubtitle: true }),
    ).toMatchObject({ value: { mode: 'direct' } })
  })
})
