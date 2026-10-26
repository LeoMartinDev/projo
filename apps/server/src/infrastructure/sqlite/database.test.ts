import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir, migrationsDir } from '../../../test/support/database.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { closeDatabase, openDatabase } from './database.ts'
import { readParsedName } from './source-columns.ts'

const expectedTables = [
  'accounts',
  'app_versions',
  'images',
  'invitations',
  'item_overrides',
  'item_people',
  'items',
  // §13.5 search (migration `search`): FTS5 table, its shadow tables, rowid mapping.
  'items_fts',
  'items_fts_config',
  'items_fts_content',
  'items_fts_data',
  'items_fts_docsize',
  'items_fts_idx',
  'jobs',
  'libraries',
  'library_roots',
  // §9.2 corrections by file (migrations `manual_matches_by_path` → `drop_item_manual_matches`).
  'manual_matches',
  'notifications',
  // §14 pairing a device (migration `pairings`).
  'pairings',
  'people',
  'playback_progress',
  'playback_sessions',
  'profile_libraries',
  'profiles',
  'scan_runs',
  'search_documents',
  'segment_lookups',
  // §12.5 contribution log (migration `segments_m4`).
  'segment_submissions',
  'segments',
  'sessions',
  'settings',
  'source_items',
  'source_subtitles',
  'sources',
  // §9.2 TMDB responses cached in the database (migration `tmdb_responses`).
  'tmdb_responses',
  'track_preferences',
  // §15 update log (migration `m5_contract`).
  'update_runs',
  'watchlist',
]

describe('openDatabase', () => {
  let temp: ReturnType<typeof createTempDir>
  beforeEach(() => {
    temp = createTempDir()
  })
  afterEach(() => {
    temp.cleanup()
  })

  const open = (file: string, backupsDir?: string) =>
    openDatabase({
      file,
      migrationsDir,
      ...(backupsDir === undefined ? {} : { backupsDir }),
      clock: createManualClock(),
      logger: silentLogger,
    })

  test('migrates an empty database to every §6 table, in WAL mode', () => {
    const opened = open(join(temp.path, 'projo.db'))
    if (!opened.ok) throw new Error(opened.error.message)
    const client = opened.value.$client

    const tables = client
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name",
      )
      .all()
      .map((row) => row.name)
    expect(tables).toEqual(expectedTables)
    const columnsOf = (table: string) =>
      client
        .query<{ name: string }, []>(`PRAGMA table_info('${table}')`)
        .all()
        .map((row) => row.name)
    // Columns added after the first schema (one merged migration since).
    expect(columnsOf('sources')).toEqual(
      expect.arrayContaining(['pending_since', 'unchanged_since']),
    )
    expect(columnsOf('playback_sessions')).toContain('audio_delivery')
    expect(
      client.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode,
    ).toBe('wal')
    expect(
      client.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys,
    ).toBe(1)
    closeDatabase(opened.value)
  })

  test('backs up an existing database only when migrations are pending', () => {
    const file = join(temp.path, 'projo.db')
    const backups = join(temp.path, 'backups')
    mkdirSync(backups)

    const first = open(file, backups)
    if (!first.ok) throw new Error(first.error.message)
    closeDatabase(first.value)
    expect(readdirSync(backups)).toEqual([])

    const second = open(file, backups)
    if (!second.ok) throw new Error(second.error.message)
    closeDatabase(second.value)
    expect(readdirSync(backups)).toEqual([])

    const raw = new Database(file)
    raw.run('DELETE FROM __drizzle_migrations')
    raw.close()

    const third = open(file, backups)
    expect(third.ok).toBe(false)
    expect(readdirSync(backups)).toHaveLength(1)
  })

  test('corrections of an existing database move to `manual_matches`, keyed by path (§9.2)', () => {
    // The migrations up to `search`, then a correction in the former per-source table.
    const partial = join(temp.path, 'migrations')
    cpSync(migrationsDir, partial, { recursive: true })
    const journalFile = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    const upTo = journal.entries.findIndex((entry) => entry.tag === '0002_search')
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }),
    )
    const file = join(temp.path, 'projo.db')
    const before = openDatabase({
      file,
      migrationsDir: partial,
      clock: createManualClock(),
      logger: silentLogger,
    })
    if (!before.ok) throw new Error(before.error.message)
    const client = before.value.$client
    client.run(`INSERT INTO libraries (id, name, created_at) VALUES ('lib', 'Films', '2026-01-01')`)
    client.run(`INSERT INTO library_roots (id, library_id, path) VALUES ('root', 'lib', '/m')`)
    client.run(
      `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, size_bytes, mtime, discovered_at, signature)
       VALUES ('src', 'lib', 'root', 'Dune.mkv', 'mkv', 'ready', 1, 1, '2026-01-01', 'sig')`,
    )
    client.run(
      `INSERT INTO item_manual_matches (source_id, tmdb_id, kind, created_by, created_at)
       VALUES ('src', 841, 'movie', 'admin', '2026-01-02')`,
    )
    closeDatabase(before.value)

    const after = open(file)
    if (!after.ok) throw new Error(after.error.message)
    expect(
      after.value.$client
        .query(
          'SELECT library_id, relative_path, signature, source_id, tmdb_id FROM manual_matches',
        )
        .all(),
    ).toEqual([
      {
        library_id: 'lib',
        relative_path: 'Dune.mkv',
        signature: 'sig',
        source_id: 'src',
        tmdb_id: 841,
      },
    ])
    // Purging the source keeps the correction.
    after.value.$client.run(`DELETE FROM sources WHERE id = 'src'`)
    expect(
      after.value.$client.query('SELECT source_id, tmdb_id FROM manual_matches').all(),
    ).toEqual([{ source_id: null, tmdb_id: 841 }])
    closeDatabase(after.value)
  })

  test('an existing database keeps its invitations and ratings through 0006 and 0007', () => {
    const partial = join(temp.path, 'migrations-m2')
    cpSync(migrationsDir, partial, { recursive: true })
    const journalFile = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    const upTo = journal.entries.findIndex((entry) => entry.tag === '0005_drop_item_manual_matches')
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }),
    )
    const file = join(temp.path, 'projo-m2.db')
    const before = openDatabase({
      file,
      migrationsDir: partial,
      clock: createManualClock(),
      logger: silentLogger,
    })
    if (!before.ok) throw new Error(before.error.message)
    const client = before.value.$client
    client.run(
      `INSERT INTO accounts (id, username, password_hash, role, created_at) VALUES ('admin-2', 'zoe', 'x', 'admin', '2026-01-01')`,
    )
    client.run(
      `INSERT INTO invitations (id, token_hash, created_by, expires_at) VALUES ('inv', 'hash', 'admin-2', '2026-02-01')`,
    )
    client.run(
      `INSERT INTO items (id, kind, title, sort_title, content_rating, created_at, updated_at) VALUES ('m', 'movie', 'M', 'm', '12', '2026-01-01', '2026-01-01')`,
    )
    closeDatabase(before.value)

    const after = open(file)
    if (!after.ok) throw new Error(after.error.message)
    const db = after.value.$client
    expect(db.query('SELECT id, created_by FROM invitations').all()).toEqual([
      { id: 'inv', created_by: 'admin-2' },
    ])
    expect(db.query('SELECT content_rating, content_rating_country FROM items').all()).toEqual([
      { content_rating: '12', content_rating_country: null },
    ])
    // The admin who created it goes, the invitation stays (§14).
    db.run(`DELETE FROM accounts WHERE id = 'admin-2'`)
    expect(db.query('SELECT id, created_by FROM invitations').all()).toEqual([
      { id: 'inv', created_by: null },
    ])
    closeDatabase(after.value)
  })

  test('genre names become genre ids through 0012 (§9.1)', () => {
    const partial = join(temp.path, 'migrations-m5')
    cpSync(migrationsDir, partial, { recursive: true })
    const journalFile = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    const upTo = journal.entries.findIndex(
      (entry) => entry.tag === '0011_jobs_state_finished_at_index',
    )
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }),
    )
    const file = join(temp.path, 'projo-m5.db')
    const before = openDatabase({
      file,
      migrationsDir: partial,
      clock: createManualClock(),
      logger: silentLogger,
    })
    if (!before.ok) throw new Error(before.error.message)
    const client = before.value.$client
    const item = (
      id: string,
      kind: string,
      genres: string,
      extra: Record<string, unknown> = {},
    ) => {
      const columns = { id, kind, title: id, sort_title: id, genres, ...extra }
      client.run(
        `INSERT INTO items (${Object.keys(columns).join(', ')}, created_at, updated_at)
         VALUES (${Object.keys(columns)
           .map(() => '?')
           .join(', ')}, '2026-01-01', '2026-01-01')`,
        Object.values(columns) as (string | number)[],
      )
    }
    const response = (key: string, genres: { id: number; name: string }[], fetchedAt: string) =>
      client.run(`INSERT INTO tmdb_responses (key, payload, fetched_at) VALUES (?, ?, ?)`, [
        key,
        JSON.stringify({ id: 1, genres }),
        fetchedAt,
      ])
    // Cached details: they win over the stored names.
    item('inception', 'movie', '["Action","Science-Fiction"]', { tmdb_id: 27205 })
    response(
      'movie/27205?append_to_response=credits&language=fr-FR',
      [
        { id: 28, name: 'Action' },
        { id: 878, name: 'Science-Fiction' },
        { id: 12, name: 'Aventure' },
      ],
      '2026-01-02',
    )
    // `movie/2720?` must not match `movie/27205?`.
    item('other', 'movie', '["Drame"]', { tmdb_id: 2720 })
    // A series: combined TMDB genres split, seasons and episodes follow.
    item('bear', 'series', '["Comédie"]', { tmdb_id: 136315 })
    response(
      'tv/136315?language=fr-FR',
      [
        { id: 10765, name: 'Science-Fiction & Fantastique' },
        { id: 18, name: 'Drame' },
        { id: 10759, name: 'Action & Adventure' },
        { id: 999_999, name: 'Inconnu' },
      ],
      '2026-01-02',
    )
    response('tv/136315/season/1?language=fr-FR', [], '2026-01-02')
    item('bear-s1', 'season', '["Comédie"]', { parent_id: 'bear', season_number: 1 })
    item('bear-e1', 'episode', '["Comédie"]', { parent_id: 'bear-s1', episode_number: 1 })
    // No cached response: by name, unknown names and duplicates dropped, order kept.
    item(
      'local',
      'movie',
      '["Guerre & Politique","Sci-Fi & Fantasy","Inconnu","Science-Fiction",{"name":"Kids"},"drame"]',
    )
    item('broken', 'movie', '"Drame"')
    // A locked item takes its override, mapped by name.
    item('locked', 'movie', '["Comédie"]', { tmdb_id: 949 })
    response('movie/949?language=fr-FR', [{ id: 80, name: 'Crime' }], '2026-01-02')
    client.run(
      `INSERT INTO item_overrides (item_id, field, value) VALUES ('locked', 'genres', '["Thriller","Comédie","Nope"]'), ('locked', 'title', '"Heat"')`,
    )
    closeDatabase(before.value)

    const after = open(file)
    if (!after.ok) throw new Error(after.error.message)
    const db = after.value.$client
    const genres = Object.fromEntries(
      db
        .query<{ id: string; genres: string }, []>('SELECT id, genres FROM items')
        .all()
        .map((row) => [row.id, JSON.parse(row.genres) as unknown]),
    )
    expect(genres).toEqual({
      inception: ['action', 'science_fiction', 'adventure'],
      other: ['drama'],
      bear: ['science_fiction', 'fantasy', 'drama', 'action', 'adventure'],
      'bear-s1': ['science_fiction', 'fantasy', 'drama', 'action', 'adventure'],
      'bear-e1': ['science_fiction', 'fantasy', 'drama', 'action', 'adventure'],
      local: ['war', 'politics', 'science_fiction', 'fantasy', 'kids', 'drama'],
      broken: [],
      locked: ['thriller', 'comedy'],
    })
    expect(db.query('SELECT field, value FROM item_overrides ORDER BY field').all()).toEqual([
      { field: 'genres', value: '["thriller","comedy"]' },
      { field: 'title', value: '"Heat"' },
    ])
    closeDatabase(after.value)
  })

  test('edition labels become edition ids through 0013 (§7.7, §8.1)', () => {
    const partial = join(temp.path, 'migrations-0012')
    cpSync(migrationsDir, partial, { recursive: true })
    const journalFile = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    const upTo = journal.entries.findIndex((entry) => entry.tag === '0012_genre_ids')
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }),
    )
    const file = join(temp.path, 'projo-0012.db')
    const before = openDatabase({
      file,
      migrationsDir: partial,
      clock: createManualClock(),
      logger: silentLogger,
    })
    if (!before.ok) throw new Error(before.error.message)
    const client = before.value.$client
    client.run(`INSERT INTO libraries (id, name, created_at) VALUES ('lib', 'Films', '2026-01-01')`)
    client.run(`INSERT INTO library_roots (id, library_id, path) VALUES ('root', 'lib', '/m')`)
    const source = (id: string, relativePath: string, parsed: unknown, stackGroupId?: string) =>
      client.run(
        `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, size_bytes, mtime, discovered_at, parsed, version_label, stack_group_id)
         VALUES (?, 'lib', 'root', ?, 'mkv', 'ready', 1, 1, '2026-01-01', ?, '2160p HDR HEVC', ?)`,
        [id, relativePath, JSON.stringify(parsed), stackGroupId ?? null],
      )
    source('dc', "Blade Runner (1982) - Director's Cut.mkv", {
      title: 'Blade Runner',
      year: 1982,
      edition: "Director's Cut",
    })
    // A stacked file: its group key ends with the edition.
    source(
      'cd1',
      'Avatar (2009)/Avatar (2009) Extended Cut cd1.mkv',
      { title: 'Avatar', year: 2009, edition: 'Extended Cut', part: { index: 1, label: 'CD 1' } },
      'root|Avatar (2009)|avatar|2009|Extended Cut',
    )
    // A `{edition-…}` tag keeps its text, even when it reads like a known label.
    source('tag', 'The Matrix (1999) {edition-Remastered}.mkv', {
      title: 'The Matrix',
      edition: 'Remastered',
    })
    source('episode', 'Show/S01E01 {edition-Version Longue}.mkv', {
      series: 'Show',
      season: 1,
      episode: 1,
      edition: 'Version Longue',
    })
    source('odd', 'Odd (2000).mkv', { title: 'Odd', edition: 'Cut Spécial' })
    source('broken', 'Broken (2000).mkv', { title: 'Broken', edition: 3 })
    source('plain', 'Plain (2000).mkv', { title: 'Plain' })
    closeDatabase(before.value)

    const after = open(file)
    if (!after.ok) throw new Error(after.error.message)
    const rows = after.value.$client
      .query<{ id: string; parsed: string; stack_group_id: string | null }, []>(
        'SELECT id, parsed, stack_group_id FROM sources',
      )
      .all()
    const parsed = Object.fromEntries(rows.map((row) => [row.id, JSON.parse(row.parsed)]))
    expect(parsed).toEqual({
      dc: { title: 'Blade Runner', year: 1982, edition: 'directors_cut' },
      cd1: { title: 'Avatar', year: 2009, edition: 'extended', part: { index: 1, label: 'CD 1' } },
      tag: { title: 'The Matrix', editionName: 'Remastered' },
      episode: { series: 'Show', season: 1, episode: 1, editionName: 'Version Longue' },
      odd: { title: 'Odd', editionName: 'Cut Spécial' },
      broken: { title: 'Broken' },
      plain: { title: 'Plain' },
    })
    expect(rows.find((row) => row.id === 'cd1')?.stack_group_id).toBe(
      'root|Avatar (2009)|avatar|2009|extended',
    )
    // Every row reads with the current schema (`readParsedName` is strict).
    for (const row of rows) expect(() => readParsedName(JSON.parse(row.parsed))).not.toThrow()
    closeDatabase(after.value)
  })

  test('TMDB items take the language their deciding library resolves to through 0014 (§9.1)', () => {
    const partial = join(temp.path, 'migrations-0013')
    cpSync(migrationsDir, partial, { recursive: true })
    const journalFile = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    const upTo = journal.entries.findIndex((entry) => entry.tag === '0013_edition_ids')
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }),
    )
    const file = join(temp.path, 'projo-0013.db')
    const before = openDatabase({
      file,
      migrationsDir: partial,
      clock: createManualClock(),
      logger: silentLogger,
    })
    if (!before.ok) throw new Error(before.error.message)
    const client = before.value.$client
    client.run(
      `INSERT INTO settings (key, value, updated_at) VALUES ('metadata.language', '"en-US"', '2026-01-01')`,
    )
    // `old` (its own language) is older than `new` (server language).
    client.run(
      `INSERT INTO libraries (id, name, metadata_language, created_at) VALUES ('new', 'Nouveau', NULL, '2026-02-01'), ('old', 'Ancien', 'de-DE', '2026-01-01')`,
    )
    client.run(
      `INSERT INTO library_roots (id, library_id, path) VALUES ('root-old', 'old', '/a'), ('root-new', 'new', '/b')`,
    )
    const item = (id: string, kind: string, extra: Record<string, string | number> = {}) => {
      const columns = { id, kind, title: id, sort_title: id, ...extra }
      client.run(
        `INSERT INTO items (${Object.keys(columns).join(', ')}, created_at, updated_at)
         VALUES (${Object.keys(columns)
           .map(() => '?')
           .join(', ')}, '2026-01-01', '2026-01-01')`,
        Object.values(columns),
      )
    }
    const source = (id: string, libraryId: string, itemId: string) => {
      client.run(
        `INSERT INTO sources (id, library_id, root_id, relative_path, extension, state, size_bytes, mtime, discovered_at)
         VALUES (?, ?, ?, ?, 'mkv', 'ready', 1, 1, '2026-01-01')`,
        [id, libraryId, `root-${libraryId}`, `${id}.mkv`],
      )
      client.run(`INSERT INTO source_items (source_id, item_id) VALUES (?, ?)`, [id, itemId])
    }
    // A series in both libraries (episode 1 only in the newer one): `old` decides the tree.
    item('series', 'series', { tmdb_id: 1 })
    item('season', 'season', { tmdb_id: 10, parent_id: 'series', season_number: 1 })
    item('e1', 'episode', { tmdb_id: 11, parent_id: 'season', season_number: 1, episode_number: 1 })
    item('e2', 'episode', { tmdb_id: 12, parent_id: 'season', season_number: 1, episode_number: 2 })
    source('f1', 'new', 'e1')
    source('f2', 'old', 'e2')
    item('movie', 'movie', { tmdb_id: 2 })
    source('f3', 'new', 'movie')
    // Without any file: the server language. A local item has no TMDB metadata.
    item('fileless', 'movie', { tmdb_id: 3 })
    item('local', 'movie')
    source('f4', 'old', 'local')
    closeDatabase(before.value)

    const after = open(file)
    if (!after.ok) throw new Error(after.error.message)
    expect(
      after.value.$client.query('SELECT id, metadata_language FROM items ORDER BY id').all(),
    ).toEqual([
      { id: 'e1', metadata_language: 'de-DE' },
      { id: 'e2', metadata_language: 'de-DE' },
      { id: 'fileless', metadata_language: 'en-US' },
      { id: 'local', metadata_language: null },
      { id: 'movie', metadata_language: 'en-US' },
      { id: 'season', metadata_language: 'de-DE' },
      { id: 'series', metadata_language: 'de-DE' },
    ])
    closeDatabase(after.value)
  })

  test('without a server setting, 0014 falls back to fr-FR (§9.1 default)', () => {
    const partial = join(temp.path, 'migrations-0013-default')
    cpSync(migrationsDir, partial, { recursive: true })
    const journalFile = join(partial, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] }
    const upTo = journal.entries.findIndex((entry) => entry.tag === '0013_edition_ids')
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, upTo + 1) }),
    )
    const file = join(temp.path, 'projo-0013-default.db')
    const before = openDatabase({
      file,
      migrationsDir: partial,
      clock: createManualClock(),
      logger: silentLogger,
    })
    if (!before.ok) throw new Error(before.error.message)
    before.value.$client.run(
      `INSERT INTO items (id, kind, title, sort_title, tmdb_id, created_at, updated_at) VALUES ('m', 'movie', 'M', 'm', 1, '2026-01-01', '2026-01-01')`,
    )
    closeDatabase(before.value)
    const after = open(file)
    if (!after.ok) throw new Error(after.error.message)
    expect(after.value.$client.query('SELECT metadata_language FROM items').all()).toEqual([
      { metadata_language: 'fr-FR' },
    ])
    closeDatabase(after.value)
  })

  test('reports a missing migrations folder as a typed error', () => {
    const opened = openDatabase({
      file: ':memory:',
      migrationsDir: join(temp.path, 'nope'),
      clock: createManualClock(),
      logger: silentLogger,
    })
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.code).toBe('db/migration_failed')
  })
})
