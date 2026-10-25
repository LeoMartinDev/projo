import { describe, expect, test } from 'bun:test'

import type { GenreId } from '@projo/shared/api/genres'

import type { PlayedItem } from '../progress/rows.ts'
import {
  categoriesOf,
  categoryBatch,
  type CategoryCount,
  categoryRows,
  type CategoryTitle,
  countCategories,
  type HomeCategory,
  selectCategories,
  seriesWithWatchedEpisodes,
  watchedTitles,
} from './categories.ts'

const day = (n: number) => new Date(Date.UTC(2026, 0, n))

const title = (
  id: string,
  genres: GenreId[],
  { added = day(1), language }: { added?: Date; language?: string } = {},
): CategoryTitle => ({
  id,
  genres,
  addedAt: added,
  ...(language === undefined ? {} : { originalLanguage: language }),
})

const genre = (id: GenreId): HomeCategory => ({ kind: 'genre', genre: id })
const anime: HomeCategory = { kind: 'anime' }
const count = (category: HomeCategory, titles: number): CategoryCount => ({ category, titles })

const played = (
  itemId: string,
  { watched = false, seriesId }: { watched?: boolean; seriesId?: string } = {},
): PlayedItem => ({
  itemId,
  kind: seriesId === undefined ? 'movie' : 'episode',
  ...(seriesId === undefined ? {} : { seriesId }),
  progress: {
    profileId: 'p',
    itemId,
    positionMs: watched ? 3_600_000 : 0,
    durationMs: 3_600_000,
    watched,
    playCount: watched ? 1 : 0,
    lastPlayedAt: day(1),
    hiddenFromContinue: false,
  },
})

describe('categoriesOf', () => {
  test('an anime counts in "Animés", not in "Animation", and keeps its other genres', () => {
    expect(categoriesOf(title('a', ['animation', 'action'], { language: 'ja' }))).toEqual([
      anime,
      genre('action'),
    ])
  })

  test('animation in another language, or Japanese live action, is no anime', () => {
    expect(categoriesOf(title('a', ['animation'], { language: 'fr' }))).toEqual([
      genre('animation'),
    ])
    expect(categoriesOf(title('b', ['drama'], { language: 'ja' }))).toEqual([genre('drama')])
    expect(categoriesOf(title('c', ['animation']))).toEqual([genre('animation')])
  })
})

describe('countCategories', () => {
  test('counts each title once per category, anime apart from animation', () => {
    const counts = countCategories([
      title('a', ['animation', 'action'], { language: 'ja' }),
      title('b', ['animation'], { language: 'ja-JP' }),
      title('c', ['animation', 'action'], { language: 'en' }),
    ])
    expect(counts).toEqual(expect.arrayContaining([count(anime, 2), count(genre('animation'), 1)]))
    expect(
      counts.find((entry) => entry.category.kind === 'genre' && entry.category.genre === 'action')
        ?.titles,
    ).toBe(2)
    expect(counts).toHaveLength(3)
  })
})

describe('selectCategories', () => {
  const rules = { minTitles: 6, maxRows: 12, rowLimit: 20, batchSize: 4 }

  test('"Animés" first, then the genres by visible titles', () => {
    expect(
      selectCategories(
        [count(genre('drama'), 13), count(anime, 7), count(genre('adventure'), 35)],
        rules,
      ),
    ).toEqual([anime, genre('adventure'), genre('drama')])
  })

  test('"Animés" comes first even with fewer titles than a genre', () => {
    expect(selectCategories([count(genre('action'), 50), count(anime, 6)], rules)[0]).toEqual(anime)
  })

  test('a category under the minimum is left out (the "Animation" rest of the anime too)', () => {
    expect(
      selectCategories(
        [count(anime, 7), count(genre('animation'), 2), count(genre('crime'), 6)],
        rules,
      ),
    ).toEqual([anime, genre('crime')])
    expect(selectCategories([count(anime, 5)], rules)).toEqual([])
  })

  test('ties follow the fixed genre order (§9.1 ids)', () => {
    expect(
      selectCategories(
        [
          count(genre('thriller'), 28),
          count(genre('science_fiction'), 28),
          count(genre('action'), 28),
        ],
        rules,
      ),
    ).toEqual([genre('action'), genre('science_fiction'), genre('thriller')])
  })

  test('at most maxRows rows', () => {
    const genres: GenreId[] = ['action', 'adventure', 'comedy', 'crime', 'drama', 'fantasy']
    const selected = selectCategories(
      [count(anime, 9), ...genres.map((id, index) => count(genre(id), 30 - index))],
      { ...rules, maxRows: 4 },
    )
    expect(selected).toEqual([anime, genre('action'), genre('adventure'), genre('comedy')])
  })

  test('deterministic: the input order does not matter', () => {
    const counts = [count(genre('drama'), 10), count(genre('comedy'), 10), count(anime, 8)]
    expect(selectCategories([...counts].reverse(), rules)).toEqual(selectCategories(counts, rules))
  })
})

describe('categoryBatch', () => {
  const list = [anime, genre('action'), genre('drama'), genre('comedy'), genre('crime')]

  test('batches of `size`, then the last one without a next offset', () => {
    expect(categoryBatch(list, 0, 2)).toEqual({ batch: [anime, genre('action')], nextOffset: 2 })
    expect(categoryBatch(list, 4, 2)).toEqual({ batch: [genre('crime')] })
    expect(categoryBatch(list, 3, 2)).toEqual({ batch: [genre('comedy'), genre('crime')] })
  })

  test('past the end, or an empty list: nothing, no next offset', () => {
    expect(categoryBatch(list, 8, 2)).toEqual({ batch: [] })
    expect(categoryBatch([], 0, 2)).toEqual({ batch: [] })
  })
})

describe('categoryRows', () => {
  test('newest first, watched titles last, limited, anime kept out of "Animation"', () => {
    const titles = [
      title('old', ['animation'], { added: day(1) }),
      title('new', ['animation'], { added: day(5) }),
      title('seen', ['animation'], { added: day(9) }),
      title('mid', ['animation'], { added: day(3) }),
      title('anime', ['animation'], { added: day(8), language: 'ja' }),
    ]
    const rows = categoryRows({
      titles,
      categories: [genre('animation'), anime],
      watched: new Set(['seen']),
      limit: 3,
    })
    expect(rows.get('genre-animation')).toEqual(['new', 'mid', 'old'])
    expect(rows.get('anime')).toEqual(['anime'])
  })

  test('the watched ones fill the end of a short row', () => {
    const rows = categoryRows({
      titles: [
        title('seen', ['drama'], { added: day(9) }),
        title('a', ['drama'], { added: day(2) }),
      ],
      categories: [genre('drama')],
      watched: new Set(['seen']),
    })
    expect(rows.get('genre-drama')).toEqual(['a', 'seen'])
  })

  test('same added date: by id, descending (stable)', () => {
    const rows = categoryRows({
      titles: [title('a', ['drama']), title('c', ['drama']), title('b', ['drama'])],
      categories: [genre('drama')],
      watched: new Set(),
    })
    expect(rows.get('genre-drama')).toEqual(['c', 'b', 'a'])
  })

  test('only the asked categories', () => {
    const rows = categoryRows({
      titles: [title('a', ['drama', 'comedy'])],
      categories: [genre('comedy')],
      watched: new Set(),
    })
    expect([...rows.keys()]).toEqual(['genre-comedy'])
  })
})

describe('watchedTitles', () => {
  const episodes = (seriesId: string, ids: string[]) => ids.map((id) => ({ id, seriesId }))

  test('watched movies, and series whose every present episode is watched', () => {
    const history = [
      played('m1', { watched: true }),
      played('m2'),
      played('a1', { watched: true, seriesId: 'a' }),
      played('a2', { watched: true, seriesId: 'a' }),
      played('b1', { watched: true, seriesId: 'b' }),
    ]
    expect(seriesWithWatchedEpisodes(history)).toEqual(['a', 'b'])
    expect(
      watchedTitles({
        played: history,
        episodes: [...episodes('a', ['a1', 'a2']), ...episodes('b', ['b1', 'b2'])],
      }),
    ).toEqual(new Set(['m1', 'a']))
  })
})
