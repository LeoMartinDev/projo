import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { hasFfmpeg } from '../../../test/support/media.ts'
import { createFfmpegImageReencoder, imageDimensions } from './ffmpeg-image-reencoder.ts'

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(import.meta.dir, '../../../test/fixtures/tmdb/images', name)))

/** An image of `width` × `height` encoded by ffmpeg, as an admin would upload it. */
const generate = (format: 'png' | 'jpg' | 'webp', width: number, height: number) => {
  const dir = mkdtempSync(join(tmpdir(), 'projo-upload-'))
  try {
    const path = join(dir, `upload.${format}`)
    const run = Bun.spawnSync([
      'ffmpeg',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc=size=${width}x${height}`,
      '-frames:v',
      '1',
      '-y',
      path,
    ])
    if (run.exitCode !== 0) throw new Error(run.stderr.toString())
    return new Uint8Array(readFileSync(path))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('imageDimensions', () => {
  test('reads PNG and JPEG headers', () => {
    expect(imageDimensions(fixture('aKsqxYP4Q8Ea9lF6CxXIG0xTsAf.png'))).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    })
    expect(imageDimensions(fixture('aej3LRUga5rhgkmRP6XMFw3ejbl.jpg'))).toMatchObject({
      width: expect.any(Number),
      height: expect.any(Number),
    })
    expect(imageDimensions(new TextEncoder().encode('not an image'))).toBeUndefined()
  })
})

describe.skipIf(!hasFfmpeg())('createFfmpegImageReencoder (real ffmpeg, §20)', () => {
  const reencoder = createFfmpegImageReencoder()

  test('a large JPEG poster is bounded to 1000 px wide, a backdrop to 1920', async () => {
    const poster = await reencoder.reencode({
      bytes: generate('jpg', 1400, 2100),
      type: 'jpeg',
      kind: 'poster',
    })
    expect(poster).toMatchObject({
      ok: true,
      value: { extension: 'jpg', width: 1000, height: 1500 },
    })
    if (!poster.ok) return
    expect(imageDimensions(poster.value.bytes)).toEqual({ width: 1000, height: 1500 })

    const backdrop = await reencoder.reencode({
      bytes: generate('jpg', 2400, 1350),
      type: 'jpeg',
      kind: 'backdrop',
    })
    expect(backdrop).toMatchObject({ ok: true, value: { width: 1920, height: 1080 } })
  })

  test('a small PNG keeps its size and stays PNG', async () => {
    const result = await reencoder.reencode({
      bytes: generate('png', 400, 600),
      type: 'png',
      kind: 'poster',
    })
    expect(result).toMatchObject({ ok: true, value: { extension: 'png', width: 400, height: 600 } })
  })

  test('WebP becomes JPEG', async () => {
    const webp = generate('webp', 300, 450)
    const result = await reencoder.reencode({ bytes: webp, type: 'webp', kind: 'poster' })
    expect(result).toMatchObject({ ok: true, value: { extension: 'jpg', width: 300, height: 450 } })
  })

  test('bytes that only look like an image are unreadable', async () => {
    const fake = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode('garbage')])
    expect(await reencoder.reencode({ bytes: fake, type: 'jpeg', kind: 'poster' })).toMatchObject({
      ok: false,
      error: { code: 'image/unreadable' },
    })
  })
})
