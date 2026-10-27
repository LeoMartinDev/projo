import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { hasFfmpegEncoder } from '../../../test/support/media.ts'
import { createImageFiles } from '../fs/image-files.ts'
import { createFfmpegImageVariants } from './ffmpeg-image-variants.ts'

let dir: ReturnType<typeof createTempDir>

beforeEach(() => {
  dir = createTempDir('projo-variants-')
  mkdirSync(join(dir.path, 'posters'))
})
afterEach(() => dir.cleanup())

/** An original as `fetch_images` stores it: `posters/<name>` of `width` × `height`. */
const original = (name: string, width: number, height: number, filter = 'testsrc') => {
  const run = Bun.spawnSync([
    'ffmpeg',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    `${filter}=size=${width}x${height}`,
    '-frames:v',
    '1',
    '-y',
    join(dir.path, 'posters', name),
  ])
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return `posters/${name}`
}

/** Width from the `VP8 ` / `VP8L` / `VP8X` chunk of a WebP file. */
const webpWidth = (path: string): number => {
  const bytes = readFileSync(path)
  const chunk = bytes.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return 1 + bytes.readUIntLE(24, 3)
  if (chunk === 'VP8L') return 1 + (bytes.readUInt16LE(21) & 0x3fff)
  return bytes.readUInt16LE(26) & 0x3fff
}

describe.skipIf(!hasFfmpegEncoder('libwebp'))(
  'createFfmpegImageVariants (real ffmpeg, §9.1)',
  () => {
    test('writes the ladder under the width and the full size, once', async () => {
      const files = createImageFiles({ imagesDir: dir.path })
      const variants = createFfmpegImageVariants({ files })
      const localPath = original('a.jpg', 500, 750)

      expect(await variants.ensure(localPath)).toEqual({ ok: true, value: true })
      const at = (name: string) => join(dir.path, 'posters', name)
      expect(webpWidth(at('a.w185.webp'))).toBe(185)
      expect(webpWidth(at('a.w342.webp'))).toBe(342)
      expect(webpWidth(at('a.full.webp'))).toBe(500)
      expect(existsSync(at('a.w500.webp'))).toBe(false)
      expect(existsSync(at('a.w185.webp.tmp'))).toBe(false)

      expect(await variants.ensure(localPath)).toEqual({ ok: true, value: false })

      await files.remove(localPath)
      expect(existsSync(at('a.jpg')) || existsSync(at('a.full.webp'))).toBe(false)
    })

    test('keeps the transparency of a PNG logo', async () => {
      const variants = createFfmpegImageVariants({
        files: createImageFiles({ imagesDir: dir.path }),
      })
      const localPath = original('logo.png', 400, 100, 'color=c=red@0.5,format=rgba,scale')
      expect((await variants.ensure(localPath)).ok).toBe(true)
      // VP8X with its alpha flag (bit 4).
      const bytes = readFileSync(join(dir.path, 'posters', 'logo.full.webp'))
      expect(bytes.toString('ascii', 12, 16)).toBe('VP8X')
      expect((bytes[20] ?? 0) & 0x10).toBe(0x10)
    })

    test('an unreadable original is an image_failed error', async () => {
      const variants = createFfmpegImageVariants({
        files: createImageFiles({ imagesDir: dir.path }),
      })
      await Bun.write(join(dir.path, 'posters', 'broken.jpg'), 'not an image')
      expect(await variants.ensure('posters/broken.jpg')).toMatchObject({
        ok: false,
        error: { code: 'metadata/image_failed' },
      })
    })
  },
)
