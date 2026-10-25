import { statSync } from 'node:fs'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { toHostPath } from '../fs/host-paths.ts'

/** Read access to media files for HTTP responses (direct stream, HLS segments). */
export type MediaFiles = {
  stat: (
    path: string,
  ) => Result<{ size: number; mtimeMs: number }, AppError<'playback/source_unavailable'>>
  /** Bytes `start..end` inclusive, streamed lazily by Bun. */
  slice: (path: string, range?: { start: number; end: number }) => Blob
}

export const createMediaFiles = (): MediaFiles => ({
  stat: (path) => {
    try {
      const stats = statSync(toHostPath(path))
      if (!stats.isFile()) {
        return err(appError('playback/source_unavailable', 'not a file', { context: { path } }))
      }
      return ok({ size: stats.size, mtimeMs: stats.mtimeMs })
    } catch (cause) {
      return err(
        appError('playback/source_unavailable', 'media file unreadable', {
          context: { path },
          cause,
        }),
      )
    }
  },
  slice: (path, range) => {
    const file = Bun.file(toHostPath(path))
    return range === undefined ? file : file.slice(range.start, range.end + 1)
  },
})
