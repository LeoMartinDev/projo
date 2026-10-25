import { describe, expect, test } from 'bun:test'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { HomeCategoriesDto } from '@projo/shared/api/home'

import { reservedRows } from './category-batches.ts'
import { categorySeeAll, recentlyAddedSeeAll } from './see-all.ts'

const item = (id: string, kind: 'movie' | 'series') => ({ id, kind }) as ItemSummaryDto
const page = (rows: number, total: number, nextCursor?: string): HomeCategoriesDto => ({
  rows: Array.from({ length: rows }, () => ({
    category: { kind: 'genre', genre: 'drama' },
    items: [],
  })),
  total,
  ...(nextCursor === undefined ? {} : { nextCursor }),
})

describe('"Tout voir ›" of the home rows (§13.3)', () => {
  const mostlySeries = [item('a', 'series'), item('b', 'series'), item('c', 'movie')]
  const half = [item('a', 'series'), item('b', 'movie')]

  test('Ajoutés récemment: the majority type, sorted by addition', () => {
    expect(recentlyAddedSeeAll(mostlySeries)).toEqual({ to: '/series', sort: 'added' })
    expect(recentlyAddedSeeAll(half)).toEqual({ to: '/movies', sort: 'added' })
  })

  test('a genre row: the majority type filtered on the genre', () => {
    expect(categorySeeAll({ kind: 'genre', genre: 'comedy' }, mostlySeries)).toEqual({
      to: '/series',
      sort: 'added',
      genre: 'comedy',
    })
    expect(categorySeeAll({ kind: 'genre', genre: 'war' }, half)).toEqual({
      to: '/movies',
      sort: 'added',
      genre: 'war',
    })
  })

  test('Animés: no link (Animation is not Animés)', () => {
    expect(categorySeeAll({ kind: 'anime' }, mostlySeries)).toBeUndefined()
  })
})

describe('reserved category rows', () => {
  test('a batch while more are coming, what is left near the end, none after the last', () => {
    expect(reservedRows([])).toBe(0)
    expect(reservedRows([page(4, 10, '4')])).toBe(4)
    expect(reservedRows([page(4, 10, '4'), page(4, 10, '8')])).toBe(2)
    expect(reservedRows([page(4, 10, '4'), page(4, 10, '8'), page(2, 10)])).toBe(0)
    expect(reservedRows([page(3, 3)])).toBe(0)
  })
})
