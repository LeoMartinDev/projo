import { describe, expect, test } from 'bun:test'

import { genreIds } from '@projo/shared/api/genres'

import { tmdbGenres } from './genres.ts'

const movieIds = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770]
const seriesIds = [16, 35, 80, 99, 18, 10751, 9648, 37, 10759, 10762, 10763, 10764, 10765, 10766]

describe('tmdbGenres', () => {
  test('movie genres', () => {
    expect(tmdbGenres('movie', [28, 878, 12])).toEqual({
      genres: ['action', 'science_fiction', 'adventure'],
      unknown: [],
    })
    expect(tmdbGenres('movie', [53, 10752, 37]).genres).toEqual(['thriller', 'war', 'western'])
  })

  test('combined series genres are split, in TMDB order', () => {
    expect(tmdbGenres('series', [10759, 18, 10765]).genres).toEqual([
      'action',
      'adventure',
      'drama',
      'science_fiction',
      'fantasy',
    ])
    expect(tmdbGenres('series', [10768, 10767]).genres).toEqual(['war', 'politics', 'talk'])
  })

  test('duplicates are dropped, the first position kept', () => {
    expect(tmdbGenres('series', [10765, 10759, 10765]).genres).toEqual([
      'science_fiction',
      'fantasy',
      'action',
      'adventure',
    ])
  })

  test('unknown ids are dropped and reported, ids of the other kind included', () => {
    expect(tmdbGenres('movie', [28, 10759, 424242])).toEqual({
      genres: ['action'],
      unknown: [10759, 424242],
    })
    expect(tmdbGenres('series', [28, 16])).toEqual({ genres: ['animation'], unknown: [28] })
  })

  test('every projo genre is reachable from TMDB', () => {
    const reached = new Set([
      ...tmdbGenres('movie', [...movieIds, 53, 10752, 37]).genres,
      ...tmdbGenres('series', [...seriesIds, 10767, 10768]).genres,
    ])
    expect([...reached].sort()).toEqual([...genreIds].sort())
  })
})
