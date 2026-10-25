import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { assessRootContent, assessRootStat } from './root-guard.ts'

const directory = { kind: 'directory' as const, sizeBytes: 0, mtimeMs: 1, inode: '1:2' }

describe('§7.5 root guard', () => {
  test('a missing, unreadable or non-directory root is unreachable', () => {
    expect(assessRootStat(ok(directory))).toEqual({ kind: 'ok' })
    expect(assessRootStat(err(appError('fs/path_not_found', 'gone')))).toMatchObject({
      kind: 'unreachable',
      reason: 'not_found',
    })
    expect(assessRootStat(err(appError('fs/io_error', 'EIO')))).toMatchObject({
      kind: 'unreachable',
      reason: 'io_error',
    })
    expect(assessRootStat(err(appError('fs/permission_denied', 'EACCES')))).toMatchObject({
      kind: 'unreachable',
      reason: 'io_error',
    })
    expect(assessRootStat(ok({ ...directory, kind: 'file' }))).toMatchObject({
      kind: 'unreachable',
      reason: 'not_directory',
    })
  })

  test('an empty root that used to hold files is an unmounted disk, not a deletion', () => {
    expect(assessRootContent({ entryCount: 0, videoCount: 0, lastFileCount: 120 })).toMatchObject({
      kind: 'unreachable',
      reason: 'empty',
    })
    expect(assessRootContent({ entryCount: 3, videoCount: 0, lastFileCount: 120 })).toMatchObject({
      kind: 'unreachable',
      reason: 'no_media',
    })
    expect(assessRootContent({ entryCount: 3, videoCount: 1, lastFileCount: 120 })).toEqual({
      kind: 'ok',
    })
    expect(assessRootContent({ entryCount: 0, videoCount: 0, lastFileCount: 0 })).toEqual({
      kind: 'ok',
    })
  })
})
