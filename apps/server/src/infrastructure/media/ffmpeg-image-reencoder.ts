import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { appError, err, ok } from '@projo/shared'

import type { ImageReencoder, UploadedImageType } from '../../core/metadata/editing.ts'
import { runProcess, stderrTail } from './process.ts'

/** §9.3: posters bounded to 1000 px wide, backdrops to 1920 px. */
const maxWidth = { poster: 1000, backdrop: 1920 } as const

const inputExtension: Record<UploadedImageType, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/** Width and height read from a PNG `IHDR` or a JPEG `SOFn` header. */
export const imageDimensions = (
  bytes: Uint8Array,
): { width: number; height: number } | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1] ?? 0
    // Padding bytes between segments.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    const length = view.getUint16(offset + 2)
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isFrame) {
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

/**
 * `ImageReencoder` over ffmpeg (§20): the upload is decoded and encoded again, metadata dropped
 * (`-map_metadata -1`), width bounded. PNG stays PNG (transparency), JPEG and WebP become JPEG.
 * Files go through a private temporary folder; arguments are an array, never a shell (§20).
 */
export const createFfmpegImageReencoder = ({
  binary = 'ffmpeg',
  timeoutMs = 30_000,
  tempDir = tmpdir(),
}: { binary?: string; timeoutMs?: number; tempDir?: string } = {}): ImageReencoder => ({
  reencode: async ({ bytes, type, kind }) => {
    let folder: string | undefined
    try {
      folder = await mkdtemp(join(tempDir, 'projo-image-'))
      const input = join(folder, `input.${inputExtension[type]}`)
      const extension = type === 'png' ? 'png' : 'jpg'
      const output = join(folder, `output.${extension}`)
      await writeFile(input, bytes)
      const width = maxWidth[kind]
      const run = await runProcess({
        command: binary,
        args: [
          '-hide_banner',
          '-nostdin',
          '-v',
          'error',
          '-i',
          // `file:` stops ffmpeg from reading a protocol or option in the name (§20).
          `file:${input}`,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-map_metadata',
          '-1',
          '-vf',
          `scale='trunc(min(iw,${width})/2)*2':-2`,
          ...(extension === 'png'
            ? ['-c:v', 'png']
            : ['-c:v', 'mjpeg', '-q:v', '3', '-pix_fmt', 'yuvj420p']),
          '-f',
          'image2',
          '-y',
          `file:${output}`,
        ],
        timeoutMs,
      })
      if (!run.ok) {
        return run.error.code === 'media/ffmpeg_failed'
          ? err(
              appError('image/unreadable', 'the image could not be decoded', {
                cause: run.error,
              }),
            )
          : err({ ...run.error, code: run.error.code })
      }
      if (run.value.exitCode !== 0) {
        return err(
          appError('image/unreadable', 'the image could not be decoded', {
            context: { exitCode: run.value.exitCode, stderr: stderrTail(run.value.stderr) },
          }),
        )
      }
      const encoded = new Uint8Array(await readFile(output))
      const dimensions = imageDimensions(encoded)
      if (dimensions === undefined) {
        return err(appError('image/unreadable', 'the re-encoded image has no readable header'))
      }
      return ok({ bytes: encoded, extension, ...dimensions })
    } catch (cause) {
      return err(appError('image/unreadable', 'the image could not be re-encoded', { cause }))
    } finally {
      if (folder !== undefined) await rm(folder, { recursive: true, force: true }).catch(() => {})
    }
  },
})
