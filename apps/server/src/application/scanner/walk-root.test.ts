import { expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import type { DirectoryEntry, FileSystem } from '../../core/fs/file-system.ts'
import type { CachedDirectory, DirectoryCache } from '../../core/scanner/ports.ts'
import { MTIME_GRANULARITY_MS, walkRootFactory } from './walk-root.ts'

test('folders excluded by name are neither stat-ed nor read', async () => {
  const tree: Record<string, DirectoryEntry[]> = {
    '/lib': [
      { name: '@eaDir', kind: 'directory' },
      { name: 'Film (2010)', kind: 'directory' },
    ],
    '/lib/Film (2010)': [
      { name: 'Extras', kind: 'directory' },
      { name: 'Film.trickplay', kind: 'directory' },
      { name: 'VIDEO_TS', kind: 'directory' },
    ],
  }
  const touched: string[] = []
  const fileSystem: FileSystem = {
    stat: async (path) => {
      touched.push(path)
      return ok({ kind: 'directory', sizeBytes: 0, mtimeMs: 1, inode: '1:1' })
    },
    readDirectory: async (path) => {
      touched.push(path)
      return ok(tree[path] ?? [])
    },
    realPath: async (path) => ok(path),
  }
  const directoryCache: DirectoryCache = {
    get: () => undefined,
    set: () => {},
    retain: () => {},
    directoriesOf: () => [],
    forget: () => {},
  }
  const walk = walkRootFactory({
    fileSystem,
    directoryCache,
    clock: createManualClock(),
    fileClock: createManualClock(),
  })

  const result = await walk({ rootId: 'r', rootPath: '/lib', incremental: false })

  expect(new Set(touched)).toEqual(new Set(['/lib', '/lib/Film (2010)']))
  expect(result.unsupportedLayouts).toEqual(['Film (2010)/VIDEO_TS'])
  expect(result.failedDirectories).toEqual([])
})

test('a link whose target cannot be reached protects what it holds (§7.5)', async () => {
  const tree: Record<string, DirectoryEntry[]> = {
    '/lib': [
      { name: 'local', kind: 'directory' },
      { name: 'nas', kind: 'symlink' },
    ],
    '/lib/local': [{ name: 'A (2001).mkv', kind: 'file' }],
  }
  const fileSystem: FileSystem = {
    stat: async (path) =>
      path === '/lib/nas'
        ? err(appError('fs/path_not_found', 'gone'))
        : ok({
            kind: path.endsWith('.mkv') ? 'file' : 'directory',
            sizeBytes: 1,
            mtimeMs: 1,
            inode: path,
          }),
    readDirectory: async (path) => ok(tree[path] ?? []),
    realPath: async (path) => ok(path),
  }
  const directoryCache: DirectoryCache = {
    get: () => undefined,
    set: () => {},
    retain: () => {},
    directoriesOf: () => [],
    forget: () => {},
  }
  const walk = walkRootFactory({
    fileSystem,
    directoryCache,
    clock: createManualClock(),
    fileClock: createManualClock(),
  })

  const result = await walk({ rootId: 'r', rootPath: '/lib', incremental: false })

  expect(result.videos.map((video) => video.relativePath)).toEqual(['local/A (2001).mkv'])
  expect(result.failedDirectories).toEqual(['nas'])
  expect(result.errors).toBe(1)
})

test('a listing is reused only once its mtime has settled: a change in the same tick is seen', async () => {
  const tree: Record<string, DirectoryEntry[]> = {
    '/lib': [{ name: 'A (2001).mkv', kind: 'file' }],
  }
  const mtimeMs = Date.parse('2026-06-01T10:00:00.000Z')
  const reads: string[] = []
  const fileSystem: FileSystem = {
    stat: async (path) =>
      path === '/lib' || tree['/lib']?.some((entry) => `/lib/${entry.name}` === path) === true
        ? ok({ kind: path === '/lib' ? 'directory' : 'file', sizeBytes: 1, mtimeMs, inode: path })
        : err(appError('fs/path_not_found', 'gone')),
    readDirectory: async (path) => {
      reads.push(path)
      return ok(tree[path] ?? [])
    },
    realPath: async (path) => ok(path),
  }
  const cached = new Map<string, CachedDirectory>()
  const directoryCache: DirectoryCache = {
    get: (_rootId, relativePath) => cached.get(relativePath),
    set: (_rootId, relativePath, entry) => void cached.set(relativePath, entry),
    retain: () => {},
    directoriesOf: () => [],
    forget: () => {},
  }
  const fileClock = createManualClock(new Date(mtimeMs))
  const walk = walkRootFactory({
    fileSystem,
    directoryCache,
    clock: createManualClock(),
    fileClock,
  })
  const videos = async () =>
    (await walk({ rootId: 'r', rootPath: '/lib', incremental: true })).videos.map(
      (video) => video.relativePath,
    )

  expect(await videos()).toEqual(['A (2001).mkv'])
  tree['/lib'] = [...(tree['/lib'] ?? []), { name: 'B (2002).mkv', kind: 'file' }]
  expect(await videos()).toEqual(['A (2001).mkv', 'B (2002).mkv'])
  expect(reads).toEqual(['/lib', '/lib'])

  fileClock.advance(MTIME_GRANULARITY_MS + 1)
  expect(await videos()).toEqual(['A (2001).mkv', 'B (2002).mkv'])
  expect(await videos()).toEqual(['A (2001).mkv', 'B (2002).mkv'])
  expect(reads).toEqual(['/lib', '/lib', '/lib'])
})
