import { readFile, rename, rm } from 'node:fs/promises'

import { appError, err, ok } from '@projo/shared'

import { expectedVariantPathsOf, type ImageVariants } from '../../core/metadata/image-variants.ts'
import type { ImageFiles } from '../../core/metadata/ports.ts'
import { imageDimensions } from './ffmpeg-image-reencoder.ts'
import { runProcess, stderrTail } from './process.ts'

/** Visually lossless for photos and logos (alpha kept), about half a TMDB JPEG at the same size. */
const QUALITY = '82'

const widthOf = (path: string): number | undefined => {
  const width = /\.w(\d+)\.webp$/u.exec(path)?.[1]
  return width === undefined ? undefined : Number(width)
}

/**
 * `ImageVariants` over ffmpeg (§9.1): one process decodes the original once and writes every
 * missing variant (`split`, then `scale` per width), each through a temporary file renamed in
 * place so a reader never sees half a WebP. Background CPU priority (§18).
 */
export const createFfmpegImageVariants = ({
  files,
  binary = 'ffmpeg',
  timeoutMs = 60_000,
}: {
  files: Pick<ImageFiles, 'absolutePath'>
  binary?: string
  timeoutMs?: number
}): ImageVariants => ({
  ensure: async (localPath, { signal } = {}) => {
    const source = files.absolutePath(localPath)
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await readFile(source))
    } catch (cause) {
      return err(
        appError('metadata/image_failed', 'image file could not be read', {
          context: { path: source },
          cause,
        }),
      )
    }
    // A header ffmpeg-image-reencoder cannot read (WebP original): the full size only.
    const width = imageDimensions(bytes)?.width ?? 0
    const targets = expectedVariantPathsOf(localPath, width).map(files.absolutePath)
    const exists = await Promise.all(targets.map((path) => Bun.file(path).exists()))
    const missing = targets.filter((_, index) => !exists[index])
    if (missing.length === 0) return ok(false)

    const split = `[0:v]split=${missing.length}${missing.map((_, i) => `[s${i}]`).join('')}`
    const scales = missing.map((path, i) => {
      const w = widthOf(path)
      return w === undefined ? `[s${i}]null[o${i}]` : `[s${i}]scale=${w}:-1:flags=lanczos[o${i}]`
    })
    const temporary = missing.map((path) => `${path}.tmp`)
    const run = await runProcess({
      command: binary,
      args: [
        '-hide_banner',
        '-nostdin',
        '-v',
        'error',
        '-i',
        // `file:` stops ffmpeg from reading a protocol or option in the name (§20).
        `file:${source}`,
        '-filter_complex',
        [split, ...scales].join(';'),
        ...temporary.flatMap((path, i) => [
          '-map',
          `[o${i}]`,
          '-frames:v',
          '1',
          '-map_metadata',
          '-1',
          '-c:v',
          'libwebp',
          '-quality',
          QUALITY,
          '-f',
          'webp',
          '-y',
          `file:${path}`,
        ]),
      ],
      timeoutMs,
      priority: 'background',
      ...(signal === undefined ? {} : { signal }),
    })
    const cleanup = () =>
      Promise.all(temporary.map((path) => rm(path, { force: true }).catch(() => {})))
    if (!run.ok) {
      await cleanup()
      return run.error.code === 'media/ffmpeg_failed'
        ? err(encodeFailed(source, { cause: run.error }))
        : err({ ...run.error, code: run.error.code })
    }
    if (run.value.exitCode !== 0) {
      await cleanup()
      return err(
        encodeFailed(source, {
          context: { exitCode: run.value.exitCode, stderr: stderrTail(run.value.stderr) },
        }),
      )
    }
    try {
      for (const [i, path] of missing.entries()) await rename(temporary[i] ?? '', path)
      return ok(true)
    } catch (cause) {
      await cleanup()
      return err(encodeFailed(source, { cause }))
    }
  },
})

const encodeFailed = (
  path: string,
  { context = {}, cause }: { context?: Record<string, unknown>; cause?: unknown },
) =>
  appError('metadata/image_failed', 'image variants could not be encoded', {
    context: { path, ...context },
    cause,
  })
