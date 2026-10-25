import { beforeEach, describe, expect, test } from 'bun:test'

import {
  insertItem,
  insertLibrary,
  insertProfile,
  insertProgress,
  insertSource,
  seedViewer,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import { createSqliteMediaAssetCatalog } from './media-asset-catalog.ts'

let db: Db

beforeEach(() => {
  db = createTestDatabase()
})

describe('listTrickplayCandidates', () => {
  test('flags the sources of an item in "Continuer à regarder" of any profile', () => {
    const { profileId } = seedViewer(db)
    const other = insertProfile(db, 'account-1', 'profile-2')
    insertLibrary(db)
    for (const id of ['started', 'other', 'watched', 'hidden', 'unplayed']) {
      insertItem(db, { id, kind: 'movie' })
      insertSource(db, { id: `source-${id}`, itemId: id })
    }
    insertProgress(db, { profileId, itemId: 'started', ratio: 0.4 })
    insertProgress(db, { profileId: other, itemId: 'other', ratio: 0.2 })
    insertProgress(db, { profileId, itemId: 'watched', ratio: 0.5, watched: true })
    insertProgress(db, { profileId, itemId: 'hidden', ratio: 0.5, hidden: true })
    const candidates = createSqliteMediaAssetCatalog({ db }).listTrickplayCandidates()
    expect(Object.fromEntries(candidates.map(({ id, inProgress }) => [id, inProgress]))).toEqual({
      'source-started': true,
      'source-other': true,
      'source-watched': false,
      'source-hidden': false,
      'source-unplayed': false,
    })
  })
})
