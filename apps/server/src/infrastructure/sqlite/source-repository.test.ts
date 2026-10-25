import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import type { SourceRepository } from '../../core/source/source.ts'
import type { Db } from './database.ts'
import { libraryRoots } from './schema/libraries.ts'
import { createSqliteSourceRepository } from './source-repository.ts'

let db: Db
let repository: SourceRepository

beforeEach(() => {
  db = createTestDatabase()
  repository = createSqliteSourceRepository({ db, ids: createSequentialIds() })
  insertLibrary(db)
})

const pending = (
  id: string,
  pendingReason: 'growing' | 'probe_failed' | 'decode_failed' | 'too_small' | undefined,
  dates: { unchangedSince?: string; stableSince?: string } = {},
) =>
  insertSource(db, {
    id,
    state: 'pending',
    ...(pendingReason === undefined ? {} : { pendingReason }),
    ...dates,
  })

describe('pendingBreakdownByLibrary (§7.3 phases)', () => {
  test('nothing pending: zeros, no counter', () => {
    insertSource(db, { id: 'ready' })
    expect(repository.pendingBreakdownByLibrary('library-1')).toEqual({
      waiting: 0,
      verifying: 0,
      failed: 0,
    })
  })

  test('quiet period running, stable, failed; the oldest running counter', () => {
    pending('w1', 'growing', { unchangedSince: '2026-06-01T10:02:00.000Z' })
    pending('w2', 'growing', { unchangedSince: '2026-06-01T10:00:30.000Z' })
    // No reason recorded: read as `growing`, like `watch_pending`.
    pending('w3', undefined, { unchangedSince: '2026-06-01T10:05:00.000Z' })
    pending('v1', 'growing', {
      unchangedSince: '2026-06-01T09:00:00.000Z',
      stableSince: '2026-06-01T09:02:00.000Z',
    })
    // Failures keep their `stable_since` (the probe ran): they stay failures.
    pending('f1', 'probe_failed', {
      unchangedSince: '2026-06-01T08:00:00.000Z',
      stableSince: '2026-06-01T08:02:00.000Z',
    })
    pending('f2', 'decode_failed')
    pending('f3', 'too_small', { unchangedSince: '2026-06-01T07:00:00.000Z' })
    insertSource(db, { id: 'ready' })
    insertSource(db, { id: 'missing', state: 'missing' })

    expect(repository.pendingBreakdownByLibrary('library-1')).toEqual({
      waiting: 3,
      verifying: 1,
      failed: 3,
      earliestUnchangedSince: new Date('2026-06-01T10:00:30.000Z'),
    })
  })

  test('other libraries and unreachable roots are left out', () => {
    insertLibrary(db, { id: 'library-2', rootPath: '/other' })
    insertSource(db, {
      id: 'elsewhere',
      libraryId: 'library-2',
      rootId: 'library-2-root',
      state: 'pending',
      pendingReason: 'growing',
    })
    pending('w1', 'growing', { unchangedSince: '2026-06-01T10:00:00.000Z' })
    db.update(libraryRoots)
      .set({ state: 'unreachable' })
      .where(eq(libraryRoots.id, 'library-1-root'))
      .run()

    expect(repository.pendingBreakdownByLibrary('library-1')).toEqual({
      waiting: 0,
      verifying: 0,
      failed: 0,
    })
    expect(repository.pendingBreakdownByLibrary('library-2')).toMatchObject({ waiting: 1 })
  })
})
