import { beforeEach, expect, test } from 'bun:test'

import { createTestDatabase } from '../../../test/support/database.ts'
import { insertItem, insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { sourceSubtitles } from './schema/libraries.ts'
import type { Db } from './database.ts'
import { createSqliteSubtitleTrackRepository } from './subtitle-track-repository.ts'

let db: Db

beforeEach(() => {
  db = createTestDatabase()
  insertLibrary(db)
  insertItem(db, { id: 'movie-1', kind: 'movie', title: 'Heat' })
  insertSource(db, { id: 'source-1', itemId: 'movie-1' })
  db.insert(sourceSubtitles)
    .values([
      { id: 'pgs', sourceId: 'source-1', kind: 'embedded', streamIndex: 4, format: 'pgs' },
      {
        id: 'srt-fr',
        sourceId: 'source-1',
        kind: 'embedded',
        streamIndex: 3,
        language: 'fr',
        forced: true,
        format: 'srt',
      },
      {
        id: 'ext-en',
        sourceId: 'source-1',
        kind: 'external',
        path: '/media/Heat.en.srt',
        language: 'en',
        sdh: true,
        format: 'srt',
      },
    ])
    .run()
})

test('lists external tracks first, then embedded ones by stream index', () => {
  const repo = createSqliteSubtitleTrackRepository({ db })
  expect(repo.listForSource('source-1').map((track) => track.id)).toEqual([
    'ext-en',
    'srt-fr',
    'pgs',
  ])
  expect(repo.listForSource('other')).toEqual([])
})

test('finds a track without null fields', () => {
  expect(createSqliteSubtitleTrackRepository({ db }).findById('ext-en')).toEqual({
    id: 'ext-en',
    sourceId: 'source-1',
    origin: 'external',
    path: '/media/Heat.en.srt',
    language: 'en',
    forced: false,
    sdh: true,
    isDefault: false,
    format: 'srt',
  })
})
