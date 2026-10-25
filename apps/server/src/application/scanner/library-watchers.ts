import type { DirectoryWatcher, WatchHandle } from '../../core/fs/file-system.ts'
import type { LibraryRepository } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import { filterFile } from '../../core/naming/index.ts'
import type { DirectoryCache, ScanRequester } from '../../core/scanner/ports.ts'

/** §7.4: a watcher event moves the next incremental scan to "now + 5 s". */
export const WATCH_DEBOUNCE_MS = 5_000

type Deps = {
  watcher: DirectoryWatcher
  libraryRepository: LibraryRepository
  directoryCache: DirectoryCache
  requestScan: ScanRequester
  logger: Logger
}

type Watched = { libraryId: string; path: string; handle: WatchHandle; directoryCount: number }

/** Events that can never change the catalog: hidden files, partial downloads (`.!qB`, `.part`…). */
const isNoise = (relativePath: string | undefined): boolean => {
  if (relativePath === undefined) return false
  const filtered = filterFile({ relativePath, sizeBytes: Number.MAX_SAFE_INTEGER })
  return (
    filtered.kind === 'ignored' &&
    (filtered.reason === 'hidden' ||
      filtered.reason === 'incomplete' ||
      filtered.reason === 'excluded')
  )
}

/**
 * Keeps one watcher per root of each library with `watch_enabled` (§7.4). `sync` is idempotent:
 * run after each scan and periodically, it arms new roots, re-arms broken ones and closes the
 * watchers of removed roots or libraries. Events only enqueue a debounced incremental scan.
 */
export const createLibraryWatchers = ({
  watcher,
  libraryRepository,
  directoryCache,
  requestScan,
  logger,
}: Deps) => {
  const watched = new Map<string, Watched>()

  const close = (rootId: string) => {
    watched.get(rootId)?.handle.close()
    watched.delete(rootId)
  }

  const sync = (): void => {
    const wanted = new Map<string, { libraryId: string; path: string }>()
    for (const library of libraryRepository.list()) {
      if (!library.watchEnabled) continue
      for (const root of library.roots) {
        if (root.state === 'ok') wanted.set(root.id, { libraryId: library.id, path: root.path })
      }
    }
    for (const [rootId, entry] of watched) {
      const want = wanted.get(rootId)
      const directories = directoryCache.directoriesOf(rootId).length
      const stale = entry.handle.mode === 'per_directory' && entry.directoryCount !== directories
      if (want === undefined || want.path !== entry.path || stale) close(rootId)
    }
    for (const [rootId, want] of wanted) {
      if (watched.has(rootId)) continue
      const directories = directoryCache.directoriesOf(rootId)
      const handle = watcher.watch({
        path: want.path,
        fallbackDirectories: directories,
        onChange: (relativePath) => {
          if (isNoise(relativePath)) return
          requestScan({ libraryId: want.libraryId, kind: 'watch', delayMs: WATCH_DEBOUNCE_MS })
        },
        onError: (error) => {
          logger.warn('library watcher stopped, periodic scans continue', {
            code: error.code,
            libraryId: want.libraryId,
            rootId,
            path: want.path,
          })
          watched.delete(rootId)
        },
      })
      if (!handle.ok) {
        logger.warn('cannot watch library root', {
          code: handle.error.code,
          libraryId: want.libraryId,
          rootId,
          path: want.path,
        })
        continue
      }
      watched.set(rootId, {
        libraryId: want.libraryId,
        path: want.path,
        handle: handle.value,
        directoryCount: directories.length,
      })
      logger.debug('watching library root', { rootId, path: want.path, mode: handle.value.mode })
    }
  }

  return {
    sync,
    /** Root id → watch mode, for tests and the admin. */
    modes: (): Map<string, WatchHandle['mode']> =>
      new Map([...watched].map(([rootId, entry]) => [rootId, entry.handle.mode])),
    stop: (): void => {
      for (const rootId of [...watched.keys()]) close(rootId)
    },
  }
}

export type LibraryWatchers = ReturnType<typeof createLibraryWatchers>
