import { beforeEach, describe, expect, test } from 'bun:test'

import type { GenreId } from '@projo/shared/api/genres'
import { type HomeCategoriesDto, homeCategoryKey } from '@projo/shared/api/home'

import { createCatalogTestApp } from '../../../../test/support/catalog-app.ts'
import {
  insertItem,
  insertLibrary,
  insertProgress,
  insertSource,
  seedSeries,
  seedViewer,
} from '../../../../test/support/catalog-fixtures.ts'

/** §13.3 item 6 over HTTP: `GET /home/categories`, batch by batch, within the §14 scope. */

let app: ReturnType<typeof createCatalogTestApp>

const get = async (path: string, as = 'leo') => {
  const response = await app.call(path, { as })
  expect(response.status).toBe(200)
  return (await response.json()) as HomeCategoriesDto
}
const keys = (batch: HomeCategoriesDto) => batch.rows.map((row) => homeCategoryKey(row.category))
const added = (n: number) => new Date(Date.UTC(2026, 1, 1, 0, n)).toISOString()

let counter = 0
/** `count` ready movies of `genres`, the latest added last. */
const movies = (
  count: number,
  genres: GenreId[],
  extra: Omit<Parameters<typeof insertItem>[1], 'id' | 'kind'> = {},
) =>
  Array.from({ length: count }, () => {
    counter += 1
    const id = `${genres.join('-')}-${counter}`
    insertItem(app.db, { id, kind: 'movie', genres, addedAt: added(counter), ...extra })
    insertSource(app.db, { id: `f-${id}`, itemId: id })
    return id
  })

beforeEach(() => {
  counter = 0
  app = createCatalogTestApp({ scopes: { 'profile-of-kid': { allowedRatings: { FR: ['TP'] } } } })
  seedViewer(app.db, 'leo')
  seedViewer(app.db, 'kid')
  insertLibrary(app.db)
})

describe('GET /home/categories', () => {
  // Action and Crime tie on 7: the §9.1 order. Western (5) is under the minimum.
  test('batches of 4 rows in the §13.3 order, then the end', async () => {
    movies(9, ['drama'])
    movies(8, ['comedy'])
    movies(7, ['action'])
    movies(7, ['crime'])
    movies(6, ['war'])
    movies(5, ['western'])
    movies(6, ['animation'], { originalLanguage: 'ja' })

    const first = await get('/home/categories')
    expect(keys(first)).toEqual(['anime', 'genre-drama', 'genre-comedy', 'genre-action'])
    expect(first.total).toBe(6)
    expect(first.nextCursor).toBe('4')
    // Newest first.
    expect(first.rows[1]?.items.map((item) => item.id)).toEqual(
      Array.from({ length: 9 }, (_, index) => `drama-${9 - index}`),
    )

    const second = await get(`/home/categories?cursor=${first.nextCursor}`)
    expect(keys(second)).toEqual(['genre-crime', 'genre-war'])
    expect(second.total).toBe(6)
    expect(second.nextCursor).toBeUndefined()

    expect(await get('/home/categories?cursor=8')).toEqual({ rows: [], total: 6 })
  })

  test('20 titles at most per row, the watched ones last', async () => {
    const ids = movies(22, ['drama'])
    const newest = ids.at(-1) ?? ''
    insertProgress(app.db, { profileId: 'profile-of-leo', itemId: newest, ratio: 1, watched: true })
    const [row] = (await get('/home/categories')).rows
    expect(row?.items).toHaveLength(20)
    // Unwatched newest first; the watched one left past the 20 shown.
    expect(row?.items[0]?.id).toBe(ids.at(-2))
    expect(row?.items.map((item) => item.id)).not.toContain(newest)
  })

  test('a series counts once, whatever its episodes; watched when all of them are', async () => {
    movies(6, ['mystery'])
    seedSeries(app.db, {
      id: 'show',
      genres: ['mystery'],
      addedAt: added(99),
      episodes: [
        [1, 1],
        [1, 2],
      ],
    })
    const before = (await get('/home/categories')).rows[0]?.items.map((item) => item.id)
    expect(before?.[0]).toBe('show')
    for (const episode of ['show-s1e1', 'show-s1e2'])
      insertProgress(app.db, {
        profileId: 'profile-of-leo',
        itemId: episode,
        ratio: 1,
        watched: true,
      })
    const after = (await get('/home/categories')).rows[0]?.items.map((item) => item.id)
    expect(after?.at(-1)).toBe('show')
    expect(after).toHaveLength(7)
  })

  test('the profile scope (§14) decides the categories and their titles', async () => {
    movies(6, ['family'], { contentRating: 'TP', contentRatingCountry: 'FR' })
    movies(6, ['horror'], { contentRating: '16', contentRatingCountry: 'FR' })
    expect(keys(await get('/home/categories'))).toEqual(['genre-family', 'genre-horror'])
    const kid = await get('/home/categories', 'kid')
    expect(keys(kid)).toEqual(['genre-family'])
    expect(kid.total).toBe(1)
  })

  test('nothing to show: an empty list, no cursor', async () => {
    movies(3, ['drama'])
    expect(await get('/home/categories')).toEqual({ rows: [], total: 0 })
  })

  test('a malformed cursor is a 400', async () => {
    const response = await app.call('/home/categories?cursor=abc')
    expect(response.status).toBe(400)
  })
})
