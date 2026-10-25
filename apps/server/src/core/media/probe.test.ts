import { describe, expect, test } from 'bun:test'

import {
  embeddedSubtitlesOf,
  type MediaProbe,
  probeDefect,
  sampleOffsets,
  signatureOf,
} from './probe.ts'

const probe: MediaProbe = {
  durationMs: 7_200_000,
  container: 'matroska,webm',
  video: [
    { index: 0, codec: 'hevc', width: 3840, height: 2160, dynamicRange: 'hdr', isDefault: true },
  ],
  audio: [{ index: 1, codec: 'eac3', channels: 6, language: 'fr', isDefault: true }],
  subtitles: [
    {
      index: 3,
      codec: 'hdmv_pgs_subtitle',
      language: 'en',
      isDefault: false,
      forced: true,
      sdh: false,
    },
    { index: 2, codec: 'subrip', isDefault: true, forced: false, sdh: true, title: 'SDH' },
  ],
  chapters: [],
}

describe('probe helpers (§7.3, §7.6, §7.7)', () => {
  test('a usable file has a duration and a video stream', () => {
    expect(probeDefect(probe)).toBeUndefined()
    expect(probeDefect({ ...probe, durationMs: 0 })).toBe('no_duration')
    expect(probeDefect({ ...probe, video: [] })).toBe('no_video')
  })

  test('three samples at 10, 50 and 90 %, kept inside short files', () => {
    expect(sampleOffsets(100_000)).toEqual([10, 50, 90])
    expect(sampleOffsets(3_000)).toEqual([0.3, 1, 1])
    expect(sampleOffsets(1_000)).toEqual([0, 0, 0])
  })

  test('signature: size, duration in ms, streams in index order', () => {
    expect(signatureOf(42, probe)).toBe('v1|42|7200000|v:hevc,a:eac3,s:subrip,s:hdmv_pgs_subtitle')
    expect(signatureOf(42, { ...probe, durationMs: 7_200_001 })).not.toBe(signatureOf(42, probe))
  })

  test('embedded subtitle rows', () => {
    expect(embeddedSubtitlesOf(probe)).toEqual([
      { streamIndex: 3, language: 'en', forced: true, sdh: false, isDefault: false, format: 'pgs' },
      { streamIndex: 2, forced: false, sdh: true, isDefault: true, format: 'srt', title: 'SDH' },
    ])
  })
})
