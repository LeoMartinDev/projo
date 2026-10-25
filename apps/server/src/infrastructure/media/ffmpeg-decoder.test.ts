import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { createFfmpegDecoder } from './ffmpeg-decoder.ts'

const dir = createTempDir('projo-decoder-')
afterAll(dir.cleanup)

/** A stand-in for ffmpeg that reports decoded frames on stdout and the given lines on stderr. */
const fakeFfmpeg = (name: string, { frames, stderr }: { frames: number; stderr: string[] }) => {
  const path = join(dir.path, name)
  const errors = stderr.map((line) => `echo '${line}' >&2`).join('\n')
  writeFileSync(path, `#!/bin/sh\necho 'frame=${frames}'\necho 'progress=end'\n${errors}\nexit 0\n`)
  chmodSync(path, 0o755)
  return path
}

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

  test('fails when no frame was decoded', async () => {
    expect((await decode(fakeFfmpeg('no-frame', { frames: 0, stderr: [] }))).ok).toBe(false)
  })
})
