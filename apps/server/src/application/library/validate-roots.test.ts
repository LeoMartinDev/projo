import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import type { FileSystem } from '../../core/fs/file-system.ts'
import { validateRootsFactory } from './validate-roots.ts'

/** `/alias` is a symbolic link to `/mnt/media`. */
const fileSystem: FileSystem = {
  stat: async () => ok({ kind: 'directory', sizeBytes: 0, mtimeMs: 0, inode: '1:1' }),
  readDirectory: async () => ok([]),
  realPath: async (path) =>
    path === '/alias' || path.startsWith('/alias/')
      ? ok(`/mnt/media${path.slice('/alias'.length)}`)
      : path.startsWith('/')
        ? ok(path)
        : err(appError('fs/path_not_found', 'not found', { context: { path } })),
}

describe('validateRoots (§7.1)', () => {
  const validate = validateRootsFactory({ fileSystem })

  test('a new root inside the target of a kept symlinked root overlaps it', async () => {
    const result = await validate({
      paths: ['/alias', '/mnt/media/movies'],
      otherRoots: [],
      alreadyValid: new Set(['/alias']),
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'library/root_overlaps' } })
  })

  test('kept roots that do not overlap pass', async () => {
    const result = await validate({
      paths: ['/alias', '/mnt/other'],
      otherRoots: [],
      alreadyValid: new Set(['/alias']),
    })
    expect(result).toEqual(ok(['/alias', '/mnt/other']))
  })
})
