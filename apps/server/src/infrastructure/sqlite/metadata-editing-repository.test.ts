import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  insertImage,
  insertItem,
  insertLibrary,
  insertSource,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { Db } from './database.ts'
import {
  createSqliteItemOverrideRepository,
  createSqliteMetadataRefreshRepository,
} from './metadata-editing-repository.ts'
import { itemOverrides, items } from './schema/items.ts'
import { libraries, sources } from './schema/libraries.ts'

const at = new Date('2026-06-01T10:00:00.000Z')
let db: Db

beforeEach(() => {
  db = createTestDatabase()
  insertLibrary(db)
})

const row = (id: string) => db.select().from(items).where(eq(items.id, id)).get()

describe('item overrides (§9.3)', () => {
  test('an edit writes the lock and the column users see, in one go', () => {
    const repo = createSqliteItemOverrideRepository({ db })
    insertItem(db, { id: 'm1', kind: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 })
    insertImage(db, 'poster-custom')
    expect(repo.get('m1')).toEqual({})

    repo.set({
      itemId: 'm1',
      overrides: {
        title: 'Origine',
        year: 2011,
        genres: ['science_fiction'],
        posterImageId: 'poster-custom',
      },
      at,
    })
    expect(repo.get('m1')).toEqual({
      title: 'Origine',
      year: 2011,
      genres: ['science_fiction'],
      posterImageId: 'poster-custom',
    })
    expect(row('m1')).toMatchObject({
      title: 'Origine',
      sortTitle: 'origine',
      year: 2011,
      genres: ['science_fiction'],
      posterImageId: 'poster-custom',
      updatedAt: at.toISOString(),
    })
    expect(repo.item('m1')).toEqual({
      id: 'm1',
      kind: 'movie',
      tmdbId: 27205,
      title: 'Origine',
      year: 2011,
      genres: ['science_fiction'],
      posterImageId: 'poster-custom',
    })

    // A second edit of the same field replaces the row.
    repo.set({ itemId: 'm1', overrides: { title: 'Inception (VF)' }, at })
    expect(repo.get('m1').title).toBe('Inception (VF)')
    expect(
      db.select().from(itemOverrides).where(eq(itemOverrides.itemId, 'm1')).all(),
    ).toHaveLength(4)
  })

  test('removing a lock keeps the value, or writes back the one given', () => {
    const repo = createSqliteItemOverrideRepository({ db })
    insertItem(db, { id: 'm1', kind: 'movie', title: 'Inception', overview: 'Dom Cobb' })
    repo.set({ itemId: 'm1', overrides: { title: 'Origine', overview: 'Mon résumé' }, at })

    repo.remove({ itemId: 'm1', field: 'title', at })
    expect(repo.get('m1')).toEqual({ overview: 'Mon résumé' })
    expect(row('m1')?.title).toBe('Origine')

    repo.remove({ itemId: 'm1', field: 'overview', restored: { overview: undefined }, at })
    expect(repo.get('m1')).toEqual({})
    expect(row('m1')?.overview).toBeNull()

    // Idempotent.
    repo.remove({ itemId: 'm1', field: 'overview', at })
    expect(repo.item('m1')).toMatchObject({ title: 'Origine', genres: [] })
    expect(repo.item('unknown')).toBeUndefined()
  })
})

describe('refresh walk (§9.4)', () => {
  const seedSeries = () => {
    insertItem(db, { id: 'series', kind: 'series', tmdbId: 136315, seriesStatus: 'in_production' })
    insertItem(db, { id: 's1', kind: 'season', parentId: 'series', seasonNumber: 1, tmdbId: 1 })
    insertItem(db, {
      id: 'e2',
      kind: 'episode',
      parentId: 's1',
      seasonNumber: 1,
      episodeNumber: 2,
      tmdbId: 12,
    })
    insertItem(db, {
      id: 'e1',
      kind: 'episode',
      parentId: 's1',
      seasonNumber: 1,
      episodeNumber: 1,
      tmdbId: 11,
    })
    insertSource(db, { id: 'src-e1', itemId: 'e1' })
    insertSource(db, { id: 'src-e2', itemId: 'e2' })
  }

  test('children in order, the library of an item or of its episodes', () => {
    const repo = createSqliteMetadataRefreshRepository({ db })
    seedSeries()
    db.update(libraries).set({ ratingCountry: 'DE', metadataLanguage: 'de-DE' }).run()
    expect(repo.children('series').map((child) => child.id)).toEqual(['s1'])
    expect(repo.children('s1').map((child) => child.id)).toEqual(['e1', 'e2'])
    expect(repo.libraryOf('series')).toEqual({ ratingCountry: 'DE', language: 'de-DE' })
    expect(repo.libraryOf('e2')).toEqual({ ratingCountry: 'DE', language: 'de-DE' })
    insertItem(db, { id: 'lonely', kind: 'movie' })
    expect(repo.libraryOf('lonely')).toBeUndefined()
  })

  test('identified movies and series of a library, once each', () => {
    const repo = createSqliteMetadataRefreshRepository({ db })
    seedSeries()
    insertItem(db, { id: 'movie', kind: 'movie', tmdbId: 27205 })
    insertSource(db, { id: 'src-movie', itemId: 'movie' })
    insertSource(db, { id: 'src-movie-4k', itemId: 'movie' })
    insertItem(db, { id: 'local', kind: 'movie' })
    insertSource(db, { id: 'src-local', itemId: 'local' })
    insertLibrary(db, { id: 'library-2', rootPath: '/other' })
    insertItem(db, { id: 'elsewhere', kind: 'movie', tmdbId: 949 })
    insertSource(db, {
      id: 'src-elsewhere',
      itemId: 'elsewhere',
      libraryId: 'library-2',
      rootId: 'library-2-root',
    })
    expect(repo.identifiedTopLevel('library-1')).toEqual(['movie', 'series'])
    expect(repo.identifiedTopLevel('library-2')).toEqual(['elsewhere'])
  })

  test('in-production series not refreshed for a week', () => {
    const repo = createSqliteMetadataRefreshRepository({ db })
    seedSeries()
    insertItem(db, {
      id: 'fresh',
      kind: 'series',
      tmdbId: 2,
      seriesStatus: 'in_production',
      metadataRefreshedAt: '2026-05-30T00:00:00.000Z',
    })
    insertItem(db, {
      id: 'old',
      kind: 'series',
      tmdbId: 3,
      seriesStatus: 'in_production',
      metadataRefreshedAt: '2026-05-01T00:00:00.000Z',
    })
    insertItem(db, {
      id: 'ended',
      kind: 'series',
      tmdbId: 4,
      seriesStatus: 'ended',
      metadataRefreshedAt: '2026-01-01T00:00:00.000Z',
    })
    insertItem(db, { id: 'local', kind: 'series', seriesStatus: 'in_production' })
    expect(repo.inProductionSeriesRefreshedBefore(new Date('2026-05-25T00:00:00.000Z'))).toEqual([
      'series',
      'old',
    ])
  })
})

describe('deciding library and stale language (§9.1, §9.4)', () => {
  /**
   * `library-1` (fr, FR, oldest) and `library-2` (en-US, US): series `both` has episode 1 in
   * library 2 and episode 2 in library 1; `movie-2` only in library 2.
   */
  const seed = () => {
    db.update(libraries)
      .set({ createdAt: '2026-01-01T00:00:00.000Z' })
      .where(eq(libraries.id, 'library-1'))
      .run()
    insertLibrary(db, { id: 'library-2', rootPath: '/other', ratingCountry: 'US' })
    db.update(libraries)
      .set({ createdAt: '2026-02-01T00:00:00.000Z', metadataLanguage: 'en-US' })
      .where(eq(libraries.id, 'library-2'))
      .run()
    insertItem(db, { id: 'both', kind: 'series', tmdbId: 1, metadataLanguage: 'fr-FR' })
    insertItem(db, {
      id: 'both-s1',
      kind: 'season',
      parentId: 'both',
      seasonNumber: 1,
      tmdbId: 10,
      metadataLanguage: 'fr-FR',
    })
    for (const [number, library] of [
      [1, 'library-2'],
      [2, 'library-1'],
    ] as const) {
      insertItem(db, {
        id: `both-e${number}`,
        kind: 'episode',
        parentId: 'both-s1',
        seasonNumber: 1,
        episodeNumber: number,
        tmdbId: 100 + number,
        metadataLanguage: 'fr-FR',
      })
      insertSource(db, {
        id: `src-e${number}`,
        itemId: `both-e${number}`,
        libraryId: library,
        rootId: `${library}-root`,
      })
    }
    insertItem(db, { id: 'movie-2', kind: 'movie', tmdbId: 2, metadataLanguage: 'en-US' })
    insertSource(db, {
      id: 'src-movie-2',
      itemId: 'movie-2',
      libraryId: 'library-2',
      rootId: 'library-2-root',
    })
    return createSqliteMetadataRefreshRepository({ db })
  }

  test('the oldest library holding a file of the tree decides, for every item of it', () => {
    const repo = seed()
    // Episode 1 is only in library 2, yet the series is decided by library 1.
    for (const id of ['both', 'both-s1', 'both-e1', 'both-e2'])
      expect(repo.libraryOf(id)).toEqual({ ratingCountry: 'FR' })
    expect(repo.libraryOf('movie-2')).toEqual({ ratingCountry: 'US', language: 'en-US' })
    // Same creation date: the id breaks the tie.
    db.update(libraries).set({ createdAt: '2026-01-01T00:00:00.000Z' }).run()
    expect(repo.libraryOf('both-e1')).toEqual({ ratingCountry: 'FR' })
    // Library 2 older: it decides.
    db.update(libraries)
      .set({ createdAt: '2025-01-01T00:00:00.000Z' })
      .where(eq(libraries.id, 'library-2'))
      .run()
    expect(repo.libraryOf('both-e2')).toEqual({ ratingCountry: 'US', language: 'en-US' })
    expect(repo.decidedBy('library-2')).toEqual(['both', 'movie-2'])
  })

  test('stale trees: a row in another language than the deciding library resolves to', () => {
    const repo = seed()
    expect(repo.staleLanguage({ serverLanguage: 'fr-FR' })).toEqual([])
    expect(repo.decidedBy('library-1')).toEqual(['both'])
    expect(repo.decidedBy('library-2')).toEqual(['movie-2'])
    // The server goes English: library 2 keeps its own language, `both` follows the server.
    expect(repo.staleLanguage({ serverLanguage: 'en-US' })).toEqual(['both'])
    // One episode still in another language is enough; local items (no TMDB id) do not count.
    db.update(items).set({ metadataLanguage: 'en-US' }).run()
    db.update(items).set({ metadataLanguage: 'fr-FR' }).where(eq(items.id, 'both-e2')).run()
    insertItem(db, { id: 'local', kind: 'movie' })
    insertSource(db, { id: 'src-local', itemId: 'local' })
    expect(repo.staleLanguage({ serverLanguage: 'en-US' })).toEqual(['both'])
    db.update(items).set({ metadataLanguage: 'en-US' }).where(eq(items.id, 'both-e2')).run()
    expect(repo.staleLanguage({ serverLanguage: 'en-US' })).toEqual([])
    // Never written (NULL) is stale too; by library: the trees with a file in it.
    db.update(items).set({ metadataLanguage: null }).where(eq(items.id, 'movie-2')).run()
    expect(repo.staleLanguage({ serverLanguage: 'en-US' })).toEqual(['movie-2'])
    expect(repo.staleLanguage({ serverLanguage: 'en-US', libraryId: 'library-1' })).toEqual([])
    expect(repo.staleLanguage({ serverLanguage: 'en-US', libraryId: 'library-2' })).toEqual([
      'movie-2',
    ])
  })

  test('tree states: deciding country, a row in another language or another rating country', () => {
    const repo = seed()
    const states = (serverLanguage = 'fr-FR') =>
      repo.treeStates({ topIds: ['both', 'movie-2', 'unknown'], serverLanguage })
    expect(states()).toEqual([
      { topId: 'both', ratingCountry: 'FR', stale: false },
      { topId: 'movie-2', ratingCountry: 'US', stale: false },
    ])
    expect(states('en-US')[0]).toEqual({ topId: 'both', ratingCountry: 'FR', stale: true })
    // A rating picked from another country than the series' (seasons and episodes inherit it).
    db.update(items).set({ contentRatingCountry: 'FR' }).where(eq(items.id, 'both')).run()
    expect(states()[0]?.stale).toBe(true)
    db.update(items).set({ contentRatingCountry: 'FR' }).run()
    expect(states()[0]?.stale).toBe(false)
    db.update(items).set({ contentRatingCountry: 'US' }).where(eq(items.id, 'both-e1')).run()
    expect(states()[0]?.stale).toBe(true)
    // No file left: left out.
    db.delete(sources).where(eq(sources.id, 'src-movie-2')).run()
    expect(states().map((state) => state.topId)).toEqual(['both'])
  })

  test('identified movies and series holding some files, by library, root or source', () => {
    const repo = seed()
    expect(repo.topLevelWithFiles({ libraryId: 'library-2' })).toEqual(['both', 'movie-2'])
    expect(repo.topLevelWithFiles({ rootIds: ['library-1-root'] })).toEqual(['both'])
    expect(repo.topLevelWithFiles({ sourceIds: ['src-movie-2', 'nope'] })).toEqual(['movie-2'])
    insertItem(db, { id: 'local', kind: 'movie' })
    insertSource(db, { id: 'src-local', itemId: 'local' })
    expect(repo.topLevelWithFiles({ sourceIds: ['src-local'] })).toEqual([])
  })
})
