import { beforeEach, describe, expect, test } from 'bun:test'

import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import {
  insertItem,
  insertLibrary,
  insertSource,
  seedViewer,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import { createSqliteMetadataItemRepository } from './metadata-item-repository.ts'
import { stripNulls } from './rows.ts'

let db: Db
let repo: MetadataItemRepository
let profileId: string
beforeEach(() => {
  db = createTestDatabase()
  repo = createSqliteMetadataItemRepository({ db })
  profileId = seedViewer(db, 'viewer').profileId
  insertItem(db, { id: 'local', kind: 'movie', title: 'Autre nom' })
  insertItem(db, { id: 'tmdb', kind: 'movie', title: 'Inception' })
})

const rows = (sql: string) =>
  (db.$client.query(sql).all() as Record<string, unknown>[]).map((row) => stripNulls(row))

const progress = (itemId: string, values: Record<string, unknown>) =>
  db.$client
    .query(
      `INSERT INTO playback_progress (profile_id, item_id, position_ms, duration_ms, watched, watched_at, play_count, last_played_at, hidden_from_continue)
       VALUES ($profile, $item, $position, 1000, $watched, $watchedAt, $count, $at, $hidden)`,
    )
    .run({
      profile: profileId,
      item: itemId,
      position: 0,
      watched: 0,
      watchedAt: null,
      count: 0,
      at: '2026-01-01T00:00:00.000Z',
      hidden: 0,
      ...values,
    })

describe('moveItemRows (local → TMDB fusion)', () => {
  test('rows without conflict move as they are', () => {
    progress('local', { position: 500, count: 1 })
    db.$client.run(
      `INSERT INTO watchlist (profile_id, item_id, added_at) VALUES ('${profileId}', 'local', '2026-01-02')`,
    )
    db.$client.run(
      `INSERT INTO track_preferences (profile_id, item_id, audio_language, subtitles_enabled, updated_at) VALUES ('${profileId}', 'local', 'fra', 1, '2026-01-02')`,
    )
    db.$client.run(
      `INSERT INTO segments (id, item_id, type, start_ms, end_ms, origin, created_at) VALUES ('seg', 'local', 'intro', 0, 1000, 'manual', '2026-01-02')`,
    )
    repo.moveItemRows({ from: 'local', into: 'tmdb' })
    expect(rows('SELECT item_id, position_ms, play_count FROM playback_progress')).toEqual([
      { item_id: 'tmdb', position_ms: 500, play_count: 1 },
    ])
    expect(rows('SELECT item_id FROM watchlist')).toEqual([{ item_id: 'tmdb' }])
    expect(rows('SELECT item_id, audio_language FROM track_preferences')).toEqual([
      { item_id: 'tmdb', audio_language: 'fra' },
    ])
    expect(rows('SELECT item_id FROM segments')).toEqual([{ item_id: 'tmdb' }])
  })

  test('progress on both: latest position, watched kept, play counts added', () => {
    progress('tmdb', {
      position: 9_000,
      watched: 1,
      watchedAt: '2026-01-05T00:00:00.000Z',
      count: 2,
      at: '2026-01-05T00:00:00.000Z',
    })
    progress('local', { position: 300, count: 1, at: '2026-02-01T00:00:00.000Z', hidden: 1 })
    repo.moveItemRows({ from: 'local', into: 'tmdb' })
    expect(rows('SELECT * FROM playback_progress')).toEqual([
      {
        profile_id: profileId,
        item_id: 'tmdb',
        position_ms: 300,
        duration_ms: 1000,
        watched: 1,
        watched_at: '2026-01-05T00:00:00.000Z',
        play_count: 3,
        last_played_at: '2026-02-01T00:00:00.000Z',
        hidden_from_continue: 1,
      },
    ])
  })

  test('older local preferences and segments of a type the target has are dropped', () => {
    db.$client.run(
      `INSERT INTO track_preferences (profile_id, item_id, audio_language, subtitles_enabled, updated_at) VALUES ('${profileId}', 'tmdb', 'eng', 0, '2026-03-01'), ('${profileId}', 'local', 'fra', 1, '2026-02-01')`,
    )
    db.$client.run(
      `INSERT INTO segments (id, item_id, type, start_ms, end_ms, origin, created_at) VALUES
        ('a', 'tmdb', 'intro', 0, 1000, 'chapter', '2026-01-02'),
        ('b', 'local', 'intro', 5, 900, 'manual', '2026-01-02'),
        ('c', 'local', 'credits', 9000, 9999, 'manual', '2026-01-02')`,
    )
    repo.moveItemRows({ from: 'local', into: 'tmdb' })
    expect(rows('SELECT item_id, audio_language FROM track_preferences')).toEqual([
      { item_id: 'tmdb', audio_language: 'eng' },
    ])
    expect(rows('SELECT id, item_id FROM segments ORDER BY id')).toEqual([
      { id: 'a', item_id: 'tmdb' },
      { id: 'c', item_id: 'tmdb' },
    ])
  })

  test('a rematch drops what the databases said about the other identity', () => {
    db.$client.run(
      `INSERT INTO segments (id, item_id, type, start_ms, end_ms, origin, created_at) VALUES
        ('p', 'local', 'intro', 0, 1000, 'theintrodb', '2026-01-02'),
        ('f', 'local', 'recap', 0, 500, 'fingerprint', '2026-01-02'),
        ('t', 'tmdb', 'credits', 9000, 9999, 'skipdb', '2026-01-02')`,
    )
    db.$client.run(
      `INSERT INTO segment_lookups (item_id, provider, checked_at, outcome) VALUES
        ('local', 'theintrodb', '2026-01-02', 'found'),
        ('local', 'chapter', '2026-01-02', 'none'),
        ('local', 'no_segment:credits', '2026-01-02', 'no_segment')`,
    )
    repo.moveItemRows({ from: 'local', into: 'tmdb' })
    // The negative marker follows and wins over the target's provider credits.
    expect(rows('SELECT id, item_id FROM segments ORDER BY id')).toEqual([
      { id: 'f', item_id: 'tmdb' },
    ])
    expect(rows('SELECT item_id, provider FROM segment_lookups')).toEqual([
      { item_id: 'tmdb', provider: 'no_segment:credits' },
    ])
  })

  test('the earliest added_at is kept', () => {
    db.$client.run(`UPDATE items SET added_at = '2026-01-01' WHERE id = 'local'`)
    db.$client.run(`UPDATE items SET added_at = '2026-04-01' WHERE id = 'tmdb'`)
    repo.moveItemRows({ from: 'local', into: 'tmdb' })
    expect(rows(`SELECT added_at FROM items WHERE id = 'tmdb'`)).toEqual([
      { added_at: '2026-01-01' },
    ])
  })
})

describe('writeMetadata', () => {
  test('absent keys untouched, undefined clears, title rewrites the sort title', () => {
    db.$client.run(`UPDATE items SET overview = 'old', year = 1999 WHERE id = 'tmdb'`)
    repo.writeMetadata({
      id: 'tmdb',
      patch: { title: 'Inception', overview: undefined, genres: ['action'] },
      language: 'en-US',
      refreshedAt: new Date('2026-06-01T00:00:00.000Z'),
    })
    expect(
      rows(
        `SELECT title, sort_title, overview, year, genres, metadata_language FROM items WHERE id = 'tmdb'`,
      ),
    ).toEqual([
      {
        title: 'Inception',
        sort_title: 'inception',
        year: 1999,
        genres: '["action"]',
        metadata_language: 'en-US',
      },
    ])
  })
})

describe('imageContext', () => {
  test('the language of the oldest library holding a file of the tree (§9.1)', () => {
    insertLibrary(db, { id: 'library-1' })
    insertLibrary(db, { id: 'library-2', rootPath: '/other' })
    db.$client.run(
      `UPDATE libraries SET created_at = '2026-01-01', metadata_language = 'de-DE' WHERE id = 'library-1'`,
    )
    db.$client.run(
      `UPDATE libraries SET created_at = '2026-02-01', metadata_language = 'en-US' WHERE id = 'library-2'`,
    )
    insertItem(db, { id: 'series', kind: 'series', tmdbId: 1 })
    insertItem(db, { id: 's1', kind: 'season', parentId: 'series', seasonNumber: 1 })
    insertItem(db, { id: 'e1', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 1 })
    insertItem(db, { id: 'e2', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 2 })
    insertSource(db, { id: 'f1', itemId: 'e1', libraryId: 'library-2', rootId: 'library-2-root' })
    insertSource(db, { id: 'f2', itemId: 'e2' })
    for (const id of ['series', 's1', 'e1', 'e2'])
      expect(repo.imageContext(id)?.libraryLanguage).toBe('de-DE')
    // The deciding library follows the server setting: no library language at all.
    db.$client.run(`UPDATE libraries SET metadata_language = NULL WHERE id = 'library-1'`)
    expect(repo.imageContext('e1')?.libraryLanguage).toBeUndefined()
  })
})
