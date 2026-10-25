import { describe, expect, test } from 'bun:test'

import { parseProbeOutput } from './ffprobe.ts'

const output = (
  streams: unknown[],
  format: Record<string, unknown> = {
    format_name: 'matroska,webm',
    duration: '5400.250000',
    bit_rate: '8000000',
  },
) =>
  JSON.stringify({
    streams,
    format,
    chapters: [{ start_time: '0.000000', end_time: '60.5', tags: { title: 'Intro' } }],
  })

describe('parseProbeOutput', () => {
  test('maps streams, drops cover art, detects HDR and Dolby Vision, normalizes languages', () => {
    const result = parseProbeOutput(
      output([
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'hevc',
          width: 3840,
          height: 2160,
          avg_frame_rate: '24000/1001',
          color_transfer: 'smpte2084',
          disposition: { default: 1 },
        },
        {
          index: 1,
          codec_type: 'video',
          codec_name: 'hevc',
          codec_tag_string: 'dvh1',
          width: 3840,
          height: 2160,
        },
        { index: 2, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        {
          index: 3,
          codec_type: 'audio',
          codec_name: 'eac3',
          channels: 6,
          sample_rate: '48000',
          tags: { language: 'fre', title: 'VFF 5.1' },
        },
        {
          index: 4,
          codec_type: 'audio',
          codec_name: 'aac',
          channels: 2,
          tags: { language: 'und' },
        },
        {
          index: 5,
          codec_type: 'subtitle',
          codec_name: 'subrip',
          tags: { LANGUAGE: 'eng', title: 'English (Forced)' },
        },
        {
          index: 6,
          codec_type: 'subtitle',
          codec_name: 'hdmv_pgs_subtitle',
          disposition: { hearing_impaired: 1 },
          tags: { language: 'ger' },
        },
      ]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      durationMs: 5_400_250,
      container: 'matroska,webm',
      bitRate: 8_000_000,
      chapters: [{ startMs: 0, endMs: 60_500, title: 'Intro' }],
    })
    expect(result.value.video.map((v) => [v.index, v.dynamicRange, v.frameRate])).toEqual([
      [0, 'hdr', 23.976],
      [1, 'dv', undefined],
    ])
    expect(result.value.audio).toEqual([
      {
        index: 3,
        codec: 'eac3',
        channels: 6,
        sampleRate: 48_000,
        language: 'fr',
        title: 'VFF 5.1',
        isDefault: false,
      },
      { index: 4, codec: 'aac', channels: 2, isDefault: false },
    ])
    expect(result.value.subtitles).toEqual([
      {
        index: 5,
        codec: 'subrip',
        language: 'en',
        title: 'English (Forced)',
        isDefault: false,
        forced: true,
        sdh: false,
      },
      {
        index: 6,
        codec: 'hdmv_pgs_subtitle',
        language: 'de',
        isDefault: false,
        forced: false,
        sdh: true,
      },
    ])
  })

  test('video codec tag and stream duration (MP4 `duration`, Matroska `DURATION` tag)', () => {
    const result = parseProbeOutput(
      output([
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'hevc',
          codec_tag_string: 'hev1',
          duration: '10.010000',
        },
        {
          index: 1,
          codec_type: 'video',
          codec_name: 'h264',
          codec_tag_string: '[0][0][0][0]',
          tags: { DURATION: '01:02:03.500000000' },
        },
      ]),
    )
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.video.map((v) => [v.codecTag, v.durationMs])).toEqual([
      ['hev1', 10_010],
      [undefined, 3_723_500],
    ])
  })

  test('invalid output is an error, a missing duration is 0', () => {
    expect(parseProbeOutput('not json')).toMatchObject({
      ok: false,
      error: { code: 'media/invalid_probe_output' },
    })
    expect(parseProbeOutput(JSON.stringify({ streams: 'x' }))).toMatchObject({ ok: false })
    expect(parseProbeOutput(output([], {}))).toMatchObject({
      ok: true,
      value: { durationMs: 0, container: 'unknown' },
    })
  })
})
