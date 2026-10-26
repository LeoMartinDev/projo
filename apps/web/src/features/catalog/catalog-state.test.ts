import { describe, expect, test } from 'bun:test'

import {
  activeFilterCount,
  arrivalState,
  clearFilters,
  decadesWithin,
  normalizeCatalogState,
  parseCatalogSearch,
  parseCatalogState,
  yearsOf,
} from './catalog-state.ts'

describe('catalog state', () => {
  test('reads a stored state and ignores what it does not understand', () => {
    expect(
      parseCatalogState({ sort: 'rating', genre: 'drama', decade: 1990, watch: 'unwatched' }),
    ).toEqual({ sort: 'rating', genre: 'drama', decade: 1990, watch: 'unwatched' })
    // A genre name saved before genre ids (§9.1) is dropped, the rest is kept.
    expect(parseCatalogState({ sort: 'year', genre: 'Drame', watch: 'watched' })).toEqual({
      sort: 'year',
      watch: 'watched',
    })
    expect(parseCatalogState({ sort: 'nope', decade: 1995, watch: 'maybe', genre: 3 })).toEqual({
      sort: 'title',
    })
    expect(parseCatalogState('garbage')).toEqual({ sort: 'title' })
  })

  test('a year implies its decade, a year outside the decade is dropped', () => {
    expect(normalizeCatalogState({ sort: 'year', year: 2014 })).toEqual({
      sort: 'year',
      decade: 2010,
      year: 2014,
    })
    expect(normalizeCatalogState({ sort: 'year', decade: 1990, year: 2014 })).toEqual({
      sort: 'year',
      decade: 1990,
    })
  })

  test('filters count and reset, the sort stays', () => {
    const state = {
      sort: 'added' as const,
      genre: 'drama' as const,
      decade: 2000,
      watch: 'watched' as const,
    }
    expect(activeFilterCount(state)).toBe(3)
    expect(clearFilters(state)).toEqual({ sort: 'added' })
  })

  test('decades and years offered', () => {
    // Bounded by the catalogue's years (`GET /genres` → `years`).
    const range = { min: 1995, max: 2023 }
    expect(decadesWithin(range)).toEqual([2020, 2010, 2000, 1990])
    expect(decadesWithin(undefined)).toEqual([])
    expect(decadesWithin(range, 1960)).toEqual([2020, 2010, 2000, 1990, 1960])
    expect(yearsOf(2020, range)).toEqual([2023, 2022, 2021, 2020])
    expect(yearsOf(1990, range)).toEqual([1999, 1998, 1997, 1996, 1995])
    expect(yearsOf(2000, range)).toHaveLength(10)
  })
})

describe('arriving from "Tout voir ›" (§13.3)', () => {
  const stored = {
    sort: 'title',
    order: 'asc',
    genre: 'drama',
    decade: 1990,
    watch: 'watched',
  } as const

  test('the URL keeps `sort=added` only', () => {
    expect(parseCatalogSearch({ sort: 'added', genre: 'comedy' })).toEqual({ sort: 'added' })
    expect(parseCatalogSearch({ sort: 'title', x: 1 })).toEqual({})
  })

  test('Ajoutés récemment: the remembered state, sorted by addition', () => {
    expect(arrivalState(stored, { sort: 'added' })).toEqual({ ...stored, sort: 'added' })
    expect(arrivalState(stored, {})).toEqual(stored)
  })
})
