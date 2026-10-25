import { beforeEach, describe, expect, test } from 'bun:test'

import {
  insertItem,
  insertLibrary,
  insertSource,
  seedSeries,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { everything, type VisibilityScope } from '../../core/catalog/catalog.ts'
import { categoriesOf, countCategories } from '../../core/home/categories.ts'
import type { Db } from './database.ts'
import { createSqliteHomeCategoryQueries } from './home-category-queries.ts'

let db: Db

const movie = (
  id: string,
  {
    library = 'library-1',
    ...extra
  }: Omit<Parameters<typeof insertItem>[1], 'id' | 'kind'> & { library?: string } = {},
) => {
  insertItem(db, { id, kind: 'movie', ...extra })
  insertSource(db, { id: `f-${id}`, itemId: id, libraryId: library, rootId: `${library}-root` })
}

const titles = (scope: VisibilityScope = everything) =>
  createSqliteHomeCategoryQueries({ db }).listTitles({ scope })

beforeEach(() => {
  db = createTestDatabase()
  insertLibrary(db, { id: 'library-1' })
  insertLibrary(db, { id: 'library-2', rootPath: '/kids' })
})

describe('§13.3 category titles', () => {
  test('visible movies and series with a genre, their language and added date', () => {
    movie('m', {
      genres: ['animation', 'action'],
      originalLanguage: 'ja',
      addedAt: '2026-02-01T00:00:00.000Z',
    })
    movie('no-genre')
    insertItem(db, { id: 'pending', kind: 'movie', genres: ['drama'] })
    insertSource(db, { id: 'f-pending', itemId: 'pending', state: 'pending' })
    seedSeries(db, { id: 'show', genres: ['drama'], episodes: [[1, 1]] })
    expect(titles().sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      {
        id: 'm',
        genres: ['animation', 'action'],
        originalLanguage: 'ja',
        addedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      // No `added_at`: `created_at`.
      { id: 'show', genres: ['drama'], addedAt: new Date('2026-01-01T00:00:00.000Z') },
    ])
  })

  test('library access (§14): titles of other libraries do not count', () => {
    movie('adult', { genres: ['thriller'] })
    movie('kids', { genres: ['animation'], library: 'library-2' })
    seedSeries(db, {
      id: 'kids-show',
      genres: ['animation'],
      episodes: [[1, 1]],
      libraryId: 'library-2',
    })
    expect(
      titles({ libraryIds: ['library-2'] })
        .map((title) => title.id)
        .sort(),
    ).toEqual(['kids', 'kids-show'])
    expect(titles({ libraryIds: [] })).toEqual([])
  })

  test('maximum rating (§14): above the cap or unknown, hidden', () => {
    movie('all', { genres: ['comedy'], contentRating: 'TP', contentRatingCountry: 'FR' })
    movie('teen', { genres: ['comedy'], contentRating: '16', contentRatingCountry: 'FR' })
    movie('unknown', { genres: ['comedy'] })
    seedSeries(db, { id: 'show', genres: ['comedy'], contentRating: '10', episodes: [[1, 1]] })
    const capped = titles({ allowedRatings: { FR: ['TP', '10'] } })
    expect(capped.map((title) => title.id).sort()).toEqual(['all', 'show'])
    expect(countCategories(capped)).toEqual([
      { category: { kind: 'genre', genre: 'comedy' }, titles: 2 },
    ])
  })

  test('the anime rule reads the stored language as `isAnime` does', () => {
    for (const [id, language] of [
      ['ja', 'ja'],
      ['region', 'ja-JP'],
      ['upper', ' JA '],
      ['en', 'en'],
    ] as const)
      movie(id, { genres: ['animation'], originalLanguage: language })
    movie('none', { genres: ['animation'] })
    const kinds = Object.fromEntries(
      titles().map((title) => [title.id, categoriesOf(title)[0]?.kind]),
    )
    expect(kinds).toEqual({
      ja: 'anime',
      region: 'anime',
      upper: 'anime',
      en: 'genre',
      none: 'genre',
    })
  })
})
