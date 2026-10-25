import { type FSWatcher, watch } from 'node:fs'
import { join } from 'node:path'

import { err, ok } from '@projo/shared'

import type { DirectoryWatcher, WatchHandle } from '../../core/fs/file-system.ts'
import type { Logger } from '../../core/logger.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { toFsError } from '../fs/node-file-system.ts'

/** Above this, the per-directory fallback gives up: the periodic scan remains (§7.4). */
const MAX_FALLBACK_DIRECTORIES = 4_000

const toPosix = (value: string): string => value.split('\\').join('/')

/**
 * `DirectoryWatcher` over `node:fs.watch`. Bun implements `recursive: true` on macOS (FSEvents)
 * and on Linux (inotify, one watch per directory, new sub-directories included); when a platform
 * refuses it, one non-recursive watcher per known directory is used instead (new directories are
 * then picked up at the next sync, after a scan).
 */
export const createNodeDirectoryWatcher = ({ logger }: { logger: Logger }): DirectoryWatcher => ({
  watch: ({ path, fallbackDirectories, onChange, onError }) => {
    const watchers: FSWatcher[] = []
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      for (const watcher of watchers) watcher.close()
    }
    const listen = (watcher: FSWatcher, absoluteDir: string) => {
      watcher.on('error', (cause: unknown) => {
        if (closed) return
        close()
        onError(toFsError(absoluteDir, cause))
      })
      watchers.push(watcher)
    }
    const relativeOf = (prefix: string, filename: unknown) => {
      const raw =
        typeof filename === 'string'
          ? filename
          : filename instanceof Buffer
            ? filename.toString()
            : undefined
      if (raw === undefined || raw === '') return prefix === '' ? undefined : prefix
      const name = toPosix(raw)
      return prefix === '' ? name : `${prefix}/${name}`
    }

    try {
      const watcher = watch(
        toHostPath(path),
        { recursive: true, persistent: false },
        (_event, filename) => {
          if (!closed) onChange(relativeOf('', filename))
        },
      )
      listen(watcher, path)
      const handle: WatchHandle = { mode: 'recursive', close }
      return ok(handle)
    } catch (cause) {
      logger.warn('recursive watch unavailable, watching directories one by one', {
        path,
        error: cause,
      })
    }

    const directories = ['', ...fallbackDirectories].slice(0, MAX_FALLBACK_DIRECTORIES)
    for (const relative of directories) {
      const absolute = relative === '' ? path : join(path, relative)
      try {
        const watcher = watch(toHostPath(absolute), { persistent: false }, (_event, filename) => {
          if (!closed) onChange(relativeOf(relative, filename))
        })
        listen(watcher, absolute)
      } catch (cause) {
        if (relative === '') {
          close()
          return err(toFsError(absolute, cause))
        }
        logger.debug('cannot watch directory', { path: absolute, error: cause })
      }
    }
    const handle: WatchHandle = { mode: 'per_directory', close }
    return ok(handle)
  },
})
