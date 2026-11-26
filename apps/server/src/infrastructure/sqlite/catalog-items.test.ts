import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'

import {
  insertImage,
  insertItem,
  insertLibrary,
  insertSource,
  seedSeries,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { CatalogItemsSort } from '../../core/metadata/catalog-items.ts'
import { toSearchExpression } from '../../core/catalog/search.ts'
import { createSqliteCatalogItems } from './catalog-items.ts'
import type { Db } from './database.ts'
import { itemOverrides, items } from './schema/items.ts'
import { sourceItems } from './schema/libraries.ts'

let db: Db
let catalogItems: ReturnType<typeof createSqliteCatalogItems>

beforeEach(() => {
  db = createTestDatabase()
  catalogItems = createSqliteCatalogItems({ db })
  insertLibrary(db, { id: 'library-1', rootPath: '/media/films' })
  insertLibrary(db, { id: 'library-2', rootPath: '/media/series' })
})

const movie = (id: string, extra: Omit<Parameters<typeof insertItem>[1], 'id' | 'kind'> = {}) => {
  insertItem(db, { id, kind: 'movie', ...extra })
  insertSource(db, { id: `f-${id}`, itemId: id })
  return id
}

const list = (
  input: Partial<Parameters<typeof catalogItems.list>[0]> & { sort?: CatalogItemsSort } = {},
) =>
  catalogItems.list({
    sort: 'title',
    order: input.sort === undefined || input.sort === 'title' ? 'asc' : 'desc',
    limit: 50,
    ...input,
  })

const ids = (rows: { id: string }[]) => rows.map((row) => row.id)

describe('the titles of Media › Catalogue (§15)', () => {
  test('movies and shows only, by title, whatever their files', () => {
    movie('zodiac', { title: 'Zodiac', sortTitle: 'zodiac' })
    movie('alien', { title: 'Alien', sortTitle: 'alien' })
    seedSeries(db, { id: 'mad-men', title: 'Mad Men', sortTitle: 'mad men', episodes: [[1, 1]] })
    insertItem(db, { id: 'kept', kind: 'movie', title: 'Kept', sortTitle: 'kept' })
    expect(ids(list())).toEqual(['alien', 'kept', 'mad-men', 'zodiac'])
  })

  test('one kind', () => {
    movie('alien')
    seedSeries(db, { id: 'mad-men', episodes: [[1, 1]] })
    expect(ids(list({ kind: 'movie' }))).toEqual(['alien'])
    expect(ids(list({ kind: 'series' }))).toEqual(['mad-men'])
  })

  test('the search matches the title or the original title, without accents', () => {
    movie('amelie', { title: 'Le Fabuleux Destin d’Amélie Poulain', originalTitle: 'Amélie' })
    movie('heat', { title: 'Heat' })
    expect(ids(list({ search: toSearchExpression('amel') ?? '' }))).toEqual(['amelie'])
    expect(ids(list({ search: toSearchExpression('fabuleux') ?? '' }))).toEqual(['amelie'])
  })

  test('a library: the movies with a file there, the shows with an episode there', () => {
    movie('alien')
    insertItem(db, { id: 'heat', kind: 'movie' })
    insertSource(db, {
      id: 'f-heat',
      itemId: 'heat',
      libraryId: 'library-2',
      rootId: 'library-2-root',
    })
    seedSeries(db, { id: 'mad-men', episodes: [[1, 1]], libraryId: 'library-2' })
    expect(ids(list({ libraryId: 'library-1' }))).toEqual(['alien'])
    expect(ids(list({ libraryId: 'library-2' }))).toEqual(['heat', 'mad-men'])
  })

  test('recently added first, then by year with the unknown last, pages after a position', () => {
    movie('a', { addedAt: '2026-01-01T00:00:00.000Z', year: 1999 })
    movie('b', { addedAt: '2026-03-01T00:00:00.000Z' })
    movie('c', { addedAt: '2026-02-01T00:00:00.000Z', year: 2010 })
    expect(ids(list({ sort: 'added' }))).toEqual(['b', 'c', 'a'])
    expect(ids(list({ sort: 'year' }))).toEqual(['c', 'a', 'b'])
    expect(ids(list({ after: { keys: ['a'], id: 'a' } }))).toEqual(['b', 'c'])
  })

  test('a movie: its files by state, its libraries by name, its poster and locked fields', () => {
    insertImage(db, 'poster-1')
    movie('alien', { tmdbId: 348, year: 1979, posterImageId: 'poster-1' })
    insertSource(db, { id: 'f-alien-4k', itemId: 'alien', state: 'missing' })
    insertSource(db, {
      id: 'f-alien-2',
      itemId: 'alien',
      libraryId: 'library-2',
      rootId: 'library-2-root',
    })
    db.insert(itemOverrides)
      .values({ itemId: 'alien', field: 'poster_image_id', value: '"x"' })
      .run()
    expect(list()).toEqual([
      {
        id: 'alien',
        kind: 'movie',
        title: 'alien',
        sortTitle: 'alien',
        year: 1979,
        posterImageId: 'poster-1',
        tmdbId: 348,
        libraries: [
          { id: 'library-1', name: 'library-1' },
          { id: 'library-2', name: 'library-2' },
        ],
        files: { ready: 2, missing: 1 },
        locked: ['poster'],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])
  })

  test('a show: its seasons, episodes and files, a file of two episodes counted once', () => {
    seedSeries(db, {
      id: 'mad-men',
      episodeCountTmdb: 92,
      episodes: [
        [1, 1],
        [1, 2],
        [2, 1],
      ],
    })
    insertItem(db, {
      id: 'mad-men-s2e2',
      kind: 'episode',
      parentId: 'mad-men-s2',
      seasonNumber: 2,
      episodeNumber: 2,
    })
    insertSource(db, { id: 'f-double', itemId: 'mad-men-s2e2' })
    db.insert(sourceItems).values({ sourceId: 'f-double', itemId: 'mad-men-s2e1' }).run()
    insertSource(db, { id: 'f-gone', state: 'missing', itemId: 'mad-men-s1e1' })
    expect(list()).toMatchObject([
      {
        id: 'mad-men',
        kind: 'series',
        files: { ready: 4, missing: 1 },
        seasons: 2,
        episodes: 4,
        episodeCountTmdb: 92,
        locked: [],
      },
    ])
  })
})

describe('the seasons of a show', () => {
  test('by number, each with its episodes by number, their files and locked fields', () => {
    seedSeries(db, {
      id: 'mad-men',
      episodes: [
        [2, 1],
        [1, 2],
        [1, 1],
      ],
    })
    insertSource(db, { id: 'f-gone', state: 'missing', itemId: 'mad-men-s1e2' })
    db.insert(itemOverrides).values({ itemId: 'mad-men-s2', field: 'title', value: '"x"' }).run()
    const seasons = catalogItems.seasons('mad-men')
    expect(seasons.map((season) => [season.id, season.seasonNumber, season.locked])).toEqual([
      ['mad-men-s1', 1, []],
      ['mad-men-s2', 2, ['title']],
    ])
    expect(seasons[0]?.episodes).toEqual([
      {
        id: 'mad-men-s1e1',
        episodeNumber: 1,
        title: 'mad-men-s1e1',
        files: { ready: 1, missing: 0 },
        locked: [],
      },
      {
        id: 'mad-men-s1e2',
        episodeNumber: 2,
        title: 'mad-men-s1e2',
        files: { ready: 1, missing: 1 },
        locked: [],
      },
    ])
  })

  test('a generic episode or season title is not its own', () => {
    seedSeries(db, { id: 'mad-men', episodes: [[1, 7]] })
    db.update(items).set({ title: 'Saison 1' }).where(eq(items.id, 'mad-men-s1')).run()
    db.update(items).set({ title: 'Épisode 7' }).where(eq(items.id, 'mad-men-s1e7')).run()
    const [season] = catalogItems.seasons('mad-men')
    expect(season?.title).toBeUndefined()
    expect(season?.episodes[0]?.title).toBeUndefined()
  })

  test('the kind of an item, or nothing for an unknown one', () => {
    seedSeries(db, { id: 'mad-men', episodes: [[1, 1]] })
    expect(catalogItems.kindOf('mad-men')).toBe('series')
    expect(catalogItems.kindOf('mad-men-s1')).toBe('season')
    expect(catalogItems.kindOf('nope')).toBeUndefined()
  })
})
