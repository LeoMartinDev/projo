import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import { insertItem, insertLibrary, insertSource } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import { libraries, sourceItems, sources } from './schema/libraries.ts'
import { createSqliteSegmentCatalog } from './segment-catalog.ts'
import { createSqliteSegmentSettings } from './segment-settings.ts'
import { settings } from './schema/ops.ts'

let db: Db

beforeEach(() => {
  db = createTestDatabase()
  insertLibrary(db)
  insertItem(db, { id: 'show', kind: 'series', tmdbId: 1399, imdbId: 'tt0944947', tvdbId: 121361 })
  insertItem(db, { id: 's1', kind: 'season', parentId: 'show', seasonNumber: 1 })
  insertItem(db, { id: 'e2', kind: 'episode', parentId: 's1', episodeNumber: 2, title: 'Two' })
  insertItem(db, { id: 'e1', kind: 'episode', parentId: 's1', episodeNumber: 1, seasonNumber: 1 })
  insertItem(db, { id: 'm1', kind: 'movie', tmdbId: 603, imdbId: 'tt0133093' })
  insertItem(db, { id: 'm2', kind: 'movie' })
  insertSource(db, { id: 'f1', itemId: 'e1' })
  insertSource(db, { id: 'f2', itemId: 'e2' })
  insertSource(db, { id: 'f3', itemId: 'm1' })
  insertSource(db, { id: 'f4', itemId: 'm2', state: 'missing' })
})

describe('SQLite segment catalog', () => {
  test('an episode is asked with its series ids, its season number from the season row', () => {
    expect(createSqliteSegmentCatalog({ db }).findItem('e2')).toEqual({
      itemId: 'e2',
      kind: 'episode',
      episodeTitle: 'Two',
      seasonId: 's1',
      seasonNumber: 1,
      episodeNumber: 2,
      tmdbId: 1399,
      imdbId: 'tt0944947',
      tvdbId: 121361,
      detectSegments: true,
      sharesFile: false,
    })
  })

  test('a movie with its own ids; detect_segments from a ready source', () => {
    const catalog = createSqliteSegmentCatalog({ db })
    expect(catalog.findItem('m1')).toEqual({
      itemId: 'm1',
      kind: 'movie',
      tmdbId: 603,
      imdbId: 'tt0133093',
      detectSegments: true,
      sharesFile: false,
    })
    expect(catalog.findItem('m2')?.detectSegments).toBe(false)
    db.update(libraries).set({ detectSegments: false }).run()
    expect(catalog.findItem('m1')?.detectSegments).toBe(false)
    expect(catalog.findItem('nope')).toBeUndefined()
  })

  test('season episodes in order', () => {
    expect(createSqliteSegmentCatalog({ db }).listSeasonEpisodeIds('s1')).toEqual(['e1', 'e2'])
  })

  test('a file holding two episodes (§8.4) is shared', () => {
    db.insert(sourceItems).values({ sourceId: 'f1', itemId: 'e2' }).run()
    const catalog = createSqliteSegmentCatalog({ db })
    expect(catalog.findItem('e2')?.sharesFile).toBe(true)
    expect(catalog.findItem('m1')?.sharesFile).toBe(false)
  })

  test('items of an unidentified file never resolved: not matched, ready, detect_segments', () => {
    const catalog = createSqliteSegmentCatalog({ db })
    // A file holding two episodes, to review.
    db.insert(sourceItems).values({ sourceId: 'f1', itemId: 'e2' }).run()
    db.update(sources).set({ matchState: 'needs_review' }).where(eq(sources.id, 'f1')).run()
    expect(catalog.listUnidentifiedItemIds('f1')).toEqual(['e1', 'e2'])
    db.$client.run(
      `INSERT INTO segment_lookups (item_id, provider, checked_at, outcome)
       VALUES ('e1', 'chapter', 'x', 'found')`,
    )
    expect(catalog.listUnidentifiedItemIds('f1')).toEqual(['e2'])
    // `unmatched` (no key, TMDB unreachable) too; never a matched or a missing file.
    expect(catalog.listUnidentifiedItemIds('f3')).toEqual(['m1'])
    db.update(sources).set({ matchState: 'matched' }).where(eq(sources.id, 'f3')).run()
    expect(catalog.listUnidentifiedItemIds('f3')).toEqual([])
    expect(catalog.listUnidentifiedItemIds('f4')).toEqual([])
    db.update(libraries).set({ detectSegments: false }).run()
    expect(catalog.listUnidentifiedItemIds('f1')).toEqual([])
  })
})

describe('items to resolve (backfill and retries, §12.2)', () => {
  const now = new Date('2026-10-24T12:00:00.000Z')
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()
  const lookup = (itemId: string, provider: string, outcome: string, checkedAt: string) =>
    db.$client.run(
      `INSERT INTO segment_lookups (item_id, provider, checked_at, outcome)
       VALUES ('${itemId}', '${provider}', '${checkedAt}', '${outcome}')`,
    )
  const resolve = (providers: ('theintrodb' | 'introdb' | 'skipdb')[] = ['theintrodb']) =>
    createSqliteSegmentCatalog({ db }).listItemsToResolve({ providers, now, limit: 10 }).toSorted()

  test('never resolved: every movie and episode with a ready source', () => {
    expect(resolve()).toEqual(['e1', 'e2', 'm1'])
    expect(
      createSqliteSegmentCatalog({ db }).listItemsToResolve({ providers: [], now, limit: 1 }),
    ).toHaveLength(1)
  })

  test('stale none (30 d) and error (7 d), missing provider; found never', () => {
    for (const id of ['e1', 'e2', 'm1']) lookup(id, 'chapter', 'none', daysAgo(1))
    lookup('e1', 'theintrodb', 'none', daysAgo(29))
    lookup('e2', 'theintrodb', 'error', daysAgo(8))
    lookup('m1', 'theintrodb', 'found', daysAgo(400))
    expect(resolve()).toEqual(['e2'])
    // A provider enabled since: asked for everyone.
    expect(resolve(['theintrodb', 'skipdb'])).toEqual(['e1', 'e2', 'm1'])
  })

  test('not when the databases cannot answer, or every type is known', () => {
    insertItem(db, { id: 'local', kind: 'movie' })
    insertSource(db, { id: 'f5', itemId: 'local' })
    lookup('local', 'chapter', 'none', daysAgo(1))
    for (const id of ['e1', 'e2', 'm1']) lookup(id, 'chapter', 'none', daysAgo(1))
    // e1 and e2 share a file.
    db.insert(sourceItems).values({ sourceId: 'f1', itemId: 'e2' }).run()
    // m1: every type settled (three segments, one negative marker).
    db.$client.run(
      `INSERT INTO segments (id, item_id, type, start_ms, end_ms, origin, created_at) VALUES
        ('a', 'm1', 'intro', 0, 1, 'manual', 'x'), ('b', 'm1', 'recap', 0, 1, 'chapter', 'x'),
        ('c', 'm1', 'credits', 0, 1, 'skipdb', 'x')`,
    )
    lookup('m1', 'no_segment:preview', 'no_segment', daysAgo(1))
    expect(resolve()).toEqual([])
  })
})

describe('SQLite segment settings', () => {
  const at = new Date('2026-10-24T00:00:00.000Z')

  test('defaults, then written values; an invalid value reads as its default', () => {
    const store = createSqliteSegmentSettings({ db })
    expect(store.read()).toMatchObject({ providers: ['theintrodb', 'introdb', 'skipdb'] })
    store.write(
      {
        providers: ['skipdb', 'introdb'],
        theintrodbApiKey: 'key-1234',
        fingerprint: { enabled: false, similarity: 0.9 },
        contribution: 'manual_only',
      },
      at,
    )
    store.saveSkipdbAnonymousKey('anon', at)
    expect(store.read()).toEqual({
      providers: ['skipdb', 'introdb'],
      theintrodbApiKey: 'key-1234',
      skipdbAnonymousKey: 'anon',
      fingerprint: {
        enabled: false,
        introMinutes: 10,
        creditsMinutes: 5,
        minSeconds: 15,
        maxSeconds: 150,
        similarity: 0.9,
      },
      contribution: 'manual_only',
    })
    store.write({ theintrodbApiKey: undefined }, at)
    expect(store.read().theintrodbApiKey).toBeUndefined()
    db.update(settings).set({ value: 'nope' }).where(eq(settings.key, 'segments.providers')).run()
    expect(store.read().providers).toEqual(['theintrodb', 'introdb', 'skipdb'])
  })
})
