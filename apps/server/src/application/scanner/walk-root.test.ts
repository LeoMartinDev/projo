import { expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import type { DirectoryEntry, FileSystem } from '../../core/fs/file-system.ts'
import type { DirectoryCache } from '../../core/scanner/ports.ts'
import { walkRootFactory } from './walk-root.ts'

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
  const walk = walkRootFactory({ fileSystem, directoryCache, clock: createManualClock() })

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
  const walk = walkRootFactory({ fileSystem, directoryCache, clock: createManualClock() })

  const result = await walk({ rootId: 'r', rootPath: '/lib', incremental: false })

  expect(result.videos.map((video) => video.relativePath)).toEqual(['local/A (2001).mkv'])
  expect(result.failedDirectories).toEqual(['nas'])
  expect(result.errors).toBe(1)
})
