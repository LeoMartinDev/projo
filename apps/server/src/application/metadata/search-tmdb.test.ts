import { describe, expect, test } from 'bun:test'

import { createReviewWorld as setup, DARK } from '../../../test/support/metadata-review-world.ts'

describe('search', () => {
  test('a movie search passes the year, in the server language by default', async () => {
    const world = setup({ sources: [] })
    await world.searchTmdb({ query: 'Inception', kind: 'movie', year: 2010 })
    expect(world.tmdbCalls).toEqual([
      { method: 'searchMovies', input: { query: 'Inception', year: 2010, language: 'fr-FR' } },
    ])
  })

  test('a series search filters on the first air year, in the asked language', async () => {
    const world = setup({ sources: [] })
    const found = await world.searchTmdb({
      query: 'Dark',
      kind: 'series',
      year: 2017,
      language: 'de-DE',
    })
    expect(found.ok && found.value.map((hit) => hit.tmdbId)).toEqual([DARK])
    expect(world.tmdbCalls).toEqual([
      { method: 'searchSeries', input: { query: 'Dark', firstAirYear: 2017, language: 'de-DE' } },
    ])
  })
})
