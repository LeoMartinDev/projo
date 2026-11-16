import { describe, expect, test } from 'bun:test'

import type { ClientCapabilities } from '@projo/shared/api/playback'

import type { PlaybackPlan } from './decide-mode.ts'
import type { VideoStreamInfo } from './media-info.ts'
import {
  hdrCopyForSdrPlayer,
  sessionSubtitleDelivery,
  streamPlaylistOf,
} from './subtitle-delivery.ts'

const video = (dynamicRange?: VideoStreamInfo['dynamicRange']): VideoStreamInfo => ({
  index: 0,
  codec: 'hevc',
  width: 3840,
  height: 2160,
  ...(dynamicRange === undefined ? {} : { dynamicRange }),
})

const remux = (dynamicRange?: VideoStreamInfo['dynamicRange']): PlaybackPlan => ({
  mode: 'hls_remux',
  quality: 'original',
  video: video(dynamicRange),
  videoCodec: 'hvc1',
})

const iphone: ClientCapabilities = {
  videoCodecs: ['avc1', 'hvc1'],
  audioCodecs: ['mp4a.40.2', 'ec-3', 'ac-3'],
  hls: 'native',
  subtitleDelivery: 'hls',
  hdrVideo: false,
}

describe('sessionSubtitleDelivery (§10.2, §10.4)', () => {
  test('a copied HDR or Dolby Vision video on an iPhone without HDR video: sidecar tracks', () => {
    for (const range of ['hdr', 'dv'] as const) {
      const input = { plan: remux(range), capabilities: iphone }
      expect(hdrCopyForSdrPlayer(input)).toBe(true)
      expect(sessionSubtitleDelivery(input)).toBe('track')
    }
  })

  test('an iPhone that renders HDR video, or did not say: renditions in the master playlist', () => {
    const { hdrVideo: _unknown, ...unknown } = iphone
    for (const capabilities of [{ ...iphone, hdrVideo: true }, unknown]) {
      expect(sessionSubtitleDelivery({ plan: remux('dv'), capabilities })).toBe('hls')
    }
  })

  test('an SDR video, or one of unknown range, keeps its master playlist', () => {
    expect(sessionSubtitleDelivery({ plan: remux('sdr'), capabilities: iphone })).toBe('hls')
    expect(sessionSubtitleDelivery({ plan: remux(), capabilities: iphone })).toBe('hls')
  })

  test('a transcoded or direct video keeps what the client asked for', () => {
    const transcode: PlaybackPlan = {
      mode: 'hls_transcode',
      quality: '1080p',
      video: video('dv'),
      reasons: ['quality'],
    }
    const direct: PlaybackPlan = {
      mode: 'direct',
      quality: 'original',
      mimeType: 'video/mp4',
      video: video('hdr'),
    }
    for (const plan of [transcode, direct]) {
      expect(sessionSubtitleDelivery({ plan, capabilities: iphone })).toBe('hls')
    }
  })

  test('only a client asking for subtitles inside native HLS changes', () => {
    const overlay = { ...iphone, subtitleDelivery: 'overlay' as const }
    expect(sessionSubtitleDelivery({ plan: remux('hdr'), capabilities: overlay })).toBe('overlay')
    const { subtitleDelivery: _none, ...unset } = iphone
    expect(sessionSubtitleDelivery({ plan: remux('hdr'), capabilities: unset })).toBe('overlay')
    const mpv = { ...iphone, subtitleDelivery: 'engine' as const }
    expect(sessionSubtitleDelivery({ plan: remux('hdr'), capabilities: mpv })).toBe('engine')
    const hlsJs = { ...iphone, hls: 'mse' as const }
    expect(hdrCopyForSdrPlayer({ plan: remux('hdr'), capabilities: hlsJs })).toBe(false)
  })
})

describe('streamPlaylistOf', () => {
  test('the master playlist only carries subtitle renditions', () => {
    expect(streamPlaylistOf('hls')).toBe('master.m3u8')
    for (const delivery of ['overlay', 'engine', 'track'] as const) {
      expect(streamPlaylistOf(delivery)).toBe('index.m3u8')
    }
  })
})
