import { describe, expect, test } from 'bun:test'

import { catalogueQuery, parseCatalogueSearch } from './catalogue-search.ts'

describe('the filters of Media › Catalogue (§15)', () => {
  test('read from the address, defaults and unknown values left out', () => {
    expect(parseCatalogueSearch({})).toEqual({})
    expect(
      parseCatalogueSearch({ q: 'mad men', kind: 'series', library: 'library-1', sort: 'added' }),
    ).toEqual({ q: 'mad men', kind: 'series', library: 'library-1', sort: 'added' })
    expect(parseCatalogueSearch({ q: '  ', kind: 'season', sort: 'title', library: 3 })).toEqual({})
    expect(parseCatalogueSearch({ sort: 'rating' })).toEqual({})
  })

  test('sent to the server: the text trimmed from two characters, the library by id', () => {
    expect(catalogueQuery({})).toEqual({})
    expect(catalogueQuery({ q: ' m ' })).toEqual({})
    expect(
      catalogueQuery({ q: ' mad ', kind: 'movie', library: 'library-1', sort: 'year' }),
    ).toEqual({ q: 'mad', kind: 'movie', libraryId: 'library-1', sort: 'year' })
  })
})
