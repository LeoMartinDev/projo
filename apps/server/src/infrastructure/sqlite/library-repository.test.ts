import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'

import { insertLibrary } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import { createSqliteLibraryRepository } from './library-repository.ts'

let db: Db
beforeEach(() => {
  db = createTestDatabase()
})

const at = new Date('2026-10-24T10:00:00.000Z')

describe('root state (§7.5)', () => {
  test('an unreachable root stores its reason code; a complete walk clears it', () => {
    const { libraryId, rootId } = insertLibrary(db)
    const repository = createSqliteLibraryRepository({ db })
    repository.markRootUnreachable({ rootId, at, reason: 'no_media' })
    expect(db.all(sql`SELECT state, last_error FROM library_roots`)).toEqual([
      { state: 'unreachable', last_error: 'no_media' },
    ])
    expect(repository.findById(libraryId)?.roots[0]).toMatchObject({
      state: 'unreachable',
      lastError: 'no_media',
    })

    repository.markRootScanned({ rootId, at, fileCount: 3 })
    const root = repository.findById(libraryId)?.roots[0]
    expect(root).toMatchObject({ state: 'ok', lastFileCount: 3 })
    expect(root?.lastError).toBeUndefined()
  })

  test('the English message of an older version is not a reason', () => {
    const { libraryId } = insertLibrary(db)
    db.run(
      sql`UPDATE library_roots SET state = 'unreachable', last_error = 'root directory is empty'`,
    )
    const root = createSqliteLibraryRepository({ db }).findById(libraryId)?.roots[0]
    expect(root?.state).toBe('unreachable')
    expect(root?.lastError).toBeUndefined()
  })
})
