import { beforeEach, describe, expect, test } from 'bun:test'

import { insertItem, insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { createSequentialIds } from '../../../test/support/fakes.ts'
import type { Db } from './database.ts'
import { createSqliteReviewQueue } from './review-queue.ts'
import { sourceItems } from './schema/libraries.ts'
import { createSqliteSourceRepository } from './source-repository.ts'

let db: Db

beforeEach(() => {
  db = createTestDatabase()
  insertLibrary(db)
  insertLibrary(db, { id: 'library-2', rootPath: '/other' })
  insertItem(db, { id: 'show', kind: 'series', title: 'Dragon Ball Super' })
  insertItem(db, { id: 's1', kind: 'season', parentId: 'show', seasonNumber: 1 })
  insertItem(db, { id: 's2', kind: 'season', parentId: 'show', seasonNumber: 2 })
  for (const [id, parentId, seasonNumber, episodeNumber] of [
    ['e1', 's1', 1, 1],
    ['e2', 's1', 1, 2],
    ['e3', 's1', 1, 3],
    ['e9', 's2', 2, 1],
  ] as const) {
    insertItem(db, { id, kind: 'episode', parentId, seasonNumber, episodeNumber })
  }
  insertItem(db, { id: 'movie', kind: 'movie', title: 'Dune' })
})

const toReview = (id: string, relativePath: string, itemId?: string) =>
  insertSource(db, {
    id,
    relativePath,
    matchState: 'needs_review',
    reviewReason: 'no_match',
    ...(itemId === undefined ? {} : { itemId }),
  })

describe('the files of "To review" (§7.8)', () => {
  test('newest first, each with its lowest episode under a show; movies and loose files bare', () => {
    toReview('a-double', 'DBS/Season 1/DBS S01E02-E03.mkv', 'e3')
    db.insert(sourceItems).values({ sourceId: 'a-double', itemId: 'e2' }).run()
    toReview('b-later', 'DBS/Season 2/DBS S02E01.mkv', 'e9')
    toReview('c-movie', 'Dune.mkv', 'movie')
    toReview('d-loose', 'DBS/Season 1/DBS Special.mkv')
    insertSource(db, { id: 'e-matched', matchState: 'matched', itemId: 'e1' })
    insertSource(db, {
      id: 'f-pending',
      state: 'pending',
      matchState: 'needs_review',
      itemId: 'e1',
    })
    insertSource(db, {
      id: 'g-other-library',
      libraryId: 'library-2',
      rootId: 'library-2-root',
      matchState: 'needs_review',
    })

    const queue = createSqliteReviewQueue({ db })
    expect(queue.candidates({ libraryId: 'library-1' })).toEqual([
      {
        id: 'd-loose',
        rootId: 'library-1-root',
        relativePath: 'DBS/Season 1/DBS Special.mkv',
        reviewReason: 'no_match',
      },
      {
        id: 'c-movie',
        rootId: 'library-1-root',
        relativePath: 'Dune.mkv',
        reviewReason: 'no_match',
      },
      {
        id: 'b-later',
        rootId: 'library-1-root',
        relativePath: 'DBS/Season 2/DBS S02E01.mkv',
        reviewReason: 'no_match',
        episode: {
          showId: 'show',
          showTitle: 'Dragon Ball Super',
          seasonNumber: 2,
          episodeNumber: 1,
        },
      },
      {
        id: 'a-double',
        rootId: 'library-1-root',
        relativePath: 'DBS/Season 1/DBS S01E02-E03.mkv',
        reviewReason: 'no_match',
        episode: {
          showId: 'show',
          showTitle: 'Dragon Ball Super',
          seasonNumber: 1,
          episodeNumber: 2,
        },
      },
    ])
    expect(queue.candidates({}).map((candidate) => candidate.id)).toEqual([
      'g-other-library',
      'd-loose',
      'c-movie',
      'b-later',
      'a-double',
    ])
  })
})

describe('listByIds', () => {
  test('in the order asked, with their items; an unknown id skipped', () => {
    toReview('x1', 'DBS/Season 1/x1.mkv', 'e1')
    toReview('x2', 'Dune.mkv', 'movie')
    const repository = createSqliteSourceRepository({ db, ids: createSequentialIds() })
    const listed = repository.listByIds(['x2', 'nope', 'x1'])
    expect(listed.map((source) => [source.id, source.rootPath, source.itemIds])).toEqual([
      ['x2', '/media', ['movie']],
      ['x1', '/media', ['e1']],
    ])
    expect(listed[1]?.items).toEqual([
      {
        id: 'e1',
        kind: 'episode',
        title: 'e1',
        seriesTitle: 'Dragon Ball Super',
        seasonNumber: 1,
        episodeNumber: 1,
      },
    ])
    expect(repository.listByIds([])).toEqual([])
  })
})
