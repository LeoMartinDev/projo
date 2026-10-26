import { describe, expect, test } from 'bun:test'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { categorySeeAll, recentlyAddedSeeAll } from './see-all.ts'

const item = (id: string, kind: 'movie' | 'series') => ({ id, kind }) as ItemSummaryDto

describe('"Tout voir ›" of the home rows (§13.3)', () => {
  const mostlySeries = [item('a', 'series'), item('b', 'series'), item('c', 'movie')]
  const half = [item('a', 'series'), item('b', 'movie')]

  test('Ajoutés récemment: the majority type, sorted by addition', () => {
    expect(recentlyAddedSeeAll(mostlySeries)).toEqual({ to: '/series', sort: 'added' })
    expect(recentlyAddedSeeAll(half)).toEqual({ to: '/movies', sort: 'added' })
  })

  test('a category row: its page, Animés included', () => {
    expect(categorySeeAll({ kind: 'genre', genre: 'comedy' })).toEqual({
      to: '/categories/$category',
      category: 'comedy',
    })
    expect(categorySeeAll({ kind: 'anime' })).toEqual({
      to: '/categories/$category',
      category: 'anime',
    })
  })
})
