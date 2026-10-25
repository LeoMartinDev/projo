import { describe, expect, test } from 'bun:test'

import type { MediaProbe } from '../../core/media/probe.ts'
import { readMediaInfo } from './probe-reader.ts'

describe('readMediaInfo (sources.probe)', () => {
  test('reads the scanner format (core/media/probe.ts)', () => {
    const probe = {
      durationMs: 5_400_000,
      container: 'matroska,webm',
      video: [
        {
          index: 0,
          codec: 'hevc',
          profile: 'Main 10',
          width: 3840,
          height: 2160,
          pixelFormat: 'yuv420p10le',
          dynamicRange: 'hdr',
          isDefault: true,
        },
      ],
      audio: [
        { index: 1, codec: 'eac3', channels: 6, language: 'fr', isDefault: true },
        { index: 2, codec: 'aac', channels: 2, language: 'en', title: 'VO', isDefault: false },
      ],
      subtitles: [
        { index: 3, codec: 'subrip', language: 'fr', isDefault: false, forced: true, sdh: false },
      ],
      chapters: [],
    } satisfies MediaProbe
    expect(readMediaInfo(probe)).toEqual({
      formatName: 'matroska,webm',
      durationMs: 5_400_000,
      video: [
        {
          index: 0,
          codec: 'hevc',
          profile: 'Main 10',
          width: 3840,
          height: 2160,
          pixelFormat: 'yuv420p10le',
          dynamicRange: 'hdr',
        },
      ],
      audio: [
        { index: 1, codec: 'eac3', channels: 6, language: 'fr', isDefault: true },
        { index: 2, codec: 'aac', channels: 2, language: 'en', title: 'VO', isDefault: false },
      ],
      subtitles: [{ index: 3, codec: 'subrip', language: 'fr', isDefault: false, forced: true }],
      chapters: [],
    })
  })

  test('reads the chapters of both formats, absent when the probe has none stored', () => {
    const stream = { index: 0, codec_type: 'video', codec_name: 'h264' }
    expect(
      readMediaInfo({
        streams: [stream],
        chapters: [
          { start_time: '60.000000', end_time: '120.5', tags: { title: 'Two' } },
          { start_time: '0.000000', end_time: '60', tags: { title: '' } },
          { start_time: 'oops' },
        ],
      })?.chapters,
    ).toEqual([
      { startMs: 0, endMs: 60_000 },
      { startMs: 60_000, endMs: 120_500, title: 'Two' },
    ])
    expect(
      readMediaInfo({
        video: [{ index: 0, codec: 'h264' }],
        chapters: [{ startMs: 0, endMs: 1_000, title: 'Intro' }],
      })?.chapters,
    ).toEqual([{ startMs: 0, endMs: 1_000, title: 'Intro' }])
    expect(readMediaInfo({ streams: [stream] })).not.toHaveProperty('chapters')
  })

  test('reads raw ffprobe JSON, skipping cover art', () => {
    expect(
      readMediaInfo({
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '12.5' },
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
          { index: 1, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          {
            index: 2,
            codec_type: 'audio',
            codec_name: 'aac',
            tags: { language: 'und' },
            disposition: { default: 1 },
          },
        ],
      }),
    ).toEqual({
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationMs: 12_500,
      video: [{ index: 1, codec: 'h264', pixelFormat: 'yuv420p' }],
      audio: [{ index: 2, codec: 'aac', isDefault: true }],
      subtitles: [],
    })
  })

  test('video codec tag and stream duration, in both formats', () => {
    expect(
      readMediaInfo({
        durationMs: 14_000,
        video: [{ index: 0, codec: 'hevc', codecTag: 'hev1', durationMs: 10_000 }],
      })?.video,
    ).toEqual([{ index: 0, codec: 'hevc', codecTag: 'hev1', durationMs: 10_000 }])
    expect(
      readMediaInfo({
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'hevc', codec_tag_string: 'hev1' },
          {
            index: 1,
            codec_type: 'video',
            codec_name: 'h264',
            codec_tag_string: '[0][0][0][0]',
            tags: { DURATION: '00:00:10.000000000' },
          },
          { index: 2, codec_type: 'video', codec_name: 'h264', duration: '9.5' },
        ],
      })?.video,
    ).toEqual([
      { index: 0, codec: 'hevc', codecTag: 'hev1' },
      { index: 1, codec: 'h264', durationMs: 10_000 },
      { index: 2, codec: 'h264', durationMs: 9_500 },
    ])
  })

  test.each([undefined, 'garbage', 42, {}, { streams: 'nope' }])(
    'unreadable %p → undefined',
    (value) => {
      expect(readMediaInfo(value)).toBeUndefined()
    },
  )
})
