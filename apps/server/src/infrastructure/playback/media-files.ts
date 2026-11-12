import { statSync } from 'node:fs'

import { appError, err, ok } from '@projo/shared'

import type { MediaFiles } from '../../core/playback/ports.ts'
import { toHostPath } from '../fs/host-paths.ts'

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
