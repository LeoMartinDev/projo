import { expect, test } from 'bun:test'

import { ok } from '@projo/shared'

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
