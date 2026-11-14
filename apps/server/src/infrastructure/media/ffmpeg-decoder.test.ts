import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { createFfmpegDecoder, decodingErrors } from './ffmpeg-decoder.ts'

const dir = createTempDir('projo-decoder-')
afterAll(dir.cleanup)

const fakeFfmpeg = (
  name: string,
  { frames, stderr, exitCode = 0 }: { frames: number; stderr: string[]; exitCode?: number },
) => {
  const path = join(dir.path, name)
  const errors = stderr.map((line) => `echo '${line}' >&2`).join('\n')
  writeFileSync(
    path,
    `#!/bin/sh\necho 'frame=${frames}'\necho 'progress=end'\n${errors}\nexit ${exitCode}\n`,
  )
  chmodSync(path, 0o755)
  return path
}

// stderr of an x265 release whose in-band VPS is malformed (production logs, -v error, frames decode)
const malformedVps = [
  '[hevc @ 0x56006ee41e40] vps_num_hrd_parameters -1 is invalid',
  '[hevc @ 0x56006ee41e40] VPS 0 does not exist',
  '[hevc @ 0x56006ee41e40] SPS 0 does not exist.',
  '[hevc @ 0x56006ee66540] vps_num_hrd_parameters -1 is invalid',
  '[hevc @ 0x56006ee66540] VPS 0 does not exist',
  '[hevc @ 0x56006ee66540] SPS 0 does not exist.',
]

describe('decodingErrors', () => {
  test('keeps no line for the HEVC parameter-set notices of a decoded sample', () => {
    expect(decodingErrors({ stderr: malformedVps.join('\n'), exitCode: 0, frames: 48 })).toEqual([])
    expect(
      decodingErrors({ stderr: '[hevc @ 0x1] PPS 3 does not exist\n', exitCode: 0, frames: 47 }),
    ).toEqual([])
  })

  test('keeps the parameter-set notices when no frame was decoded or ffmpeg failed', () => {
    const stderr = malformedVps.join('\n')
    expect(decodingErrors({ stderr, exitCode: 0, frames: 0 })).toEqual(malformedVps)
    expect(decodingErrors({ stderr, exitCode: 1, frames: 48 })).toEqual(malformedVps)
  })

  test('keeps any other decoding error beside the notices', () => {
    const corrupt = [
      '[hevc @ 0x56006ee41e40] PPS id out of range: 0',
      '[hevc @ 0x56006ee41e40] Error parsing NAL unit #2.',
      '[hevc @ 0x56006ee41e40] Could not find ref with POC 12',
    ]
    expect(
      decodingErrors({ stderr: [...malformedVps, ...corrupt].join('\n'), exitCode: 0, frames: 48 }),
    ).toEqual(corrupt)
  })

  test('only ignores the notices from the HEVC decoder', () => {
    const line = '[h264 @ 0x1] SPS 0 does not exist.'
    expect(decodingErrors({ stderr: line, exitCode: 0, frames: 48 })).toEqual([line])
  })
})

const decode = (binary: string) =>
  createFfmpegDecoder({ binary }).decodeSample({
    path: '/media/Film (2020).mkv',
    startSeconds: 0,
    durationSeconds: 2,
  })

describe('createFfmpegDecoder', () => {
  test('ignores the null muxer DTS notices of 24 fps MKV with B-frames (ffmpeg 7.x)', async () => {
    const binary = fakeFfmpeg('dts-notice', {
      frames: 48,
      stderr: [
        '[null @ 0xaaaaecf7e420] Application provided invalid, non monotonically increasing dts to muxer in stream 0: 2 >= 2',
      ],
    })
    expect((await decode(binary)).ok).toBe(true)
  })

  test('fails on a decoder error even when frames were decoded', async () => {
    const binary = fakeFfmpeg('decoder-error', {
      frames: 12,
      stderr: ['[h264 @ 0xaaaaf6d344a0] error while decoding MB 8 3'],
    })
    const result = await decode(binary)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('media/ffmpeg_failed')
  })

  test('passes an x265 sample whose malformed VPS only logs parameter-set notices', async () => {
    const binary = fakeFfmpeg('malformed-vps', { frames: 48, stderr: malformedVps })
    expect((await decode(binary)).ok).toBe(true)
  })

  test('fails on a real HEVC decoding error after the parameter-set notices', async () => {
    const binary = fakeFfmpeg('hevc-corrupt', {
      frames: 48,
      stderr: [...malformedVps, '[hevc @ 0x56006ee41e40] Could not find ref with POC 12'],
    })
    const result = await decode(binary)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('media/ffmpeg_failed')
  })

  test('fails when only parameter-set notices were logged but no frame was decoded', async () => {
    const binary = fakeFfmpeg('hevc-no-frame', { frames: 0, stderr: malformedVps })
    expect((await decode(binary)).ok).toBe(false)
  })

  test('fails when ffmpeg exits with an error', async () => {
    const binary = fakeFfmpeg('exit-error', { frames: 48, stderr: malformedVps, exitCode: 1 })
    expect((await decode(binary)).ok).toBe(false)
  })

  test('fails when no frame was decoded', async () => {
    expect((await decode(fakeFfmpeg('no-frame', { frames: 0, stderr: [] }))).ok).toBe(false)
  })
})
