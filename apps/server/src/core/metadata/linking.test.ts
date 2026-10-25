import { describe, expect, test } from 'bun:test'

import { adoptableMovie, episodeSpan, type LinkedItemInfo, pairReplacedItems } from './linking.ts'

const local = (
  id: string,
  kind: LinkedItemInfo['kind'],
  episodeNumber?: number,
): LinkedItemInfo => ({
  id,
  kind,
  ...(episodeNumber === undefined ? {} : { episodeNumber }),
})

describe('local → TMDB fusion (§9.2)', () => {
  test('a single local movie is adopted; none or several are not', () => {
    expect(adoptableMovie([local('m1', 'movie')])).toBe('m1')
    expect(adoptableMovie([])).toBeUndefined()
    expect(adoptableMovie([local('m1', 'movie'), local('m2', 'movie')])).toBeUndefined()
    expect(adoptableMovie([{ ...local('m1', 'movie'), tmdbId: 27205 }])).toBeUndefined()
  })

  test('a local movie left behind hands its rows to the TMDB movie', () => {
    expect(pairReplacedItems([local('local', 'movie')], [{ id: 'tmdb' }])).toEqual([
      { from: 'local', into: 'tmdb' },
    ])
  })

  test('an adopted item (same id) is not paired', () => {
    expect(pairReplacedItems([local('same', 'movie')], [{ id: 'same' }])).toEqual([])
  })

  test('episodes pair by number (multi-episode file)', () => {
    expect(
      pairReplacedItems(
        [local('e1', 'episode', 1), local('e2', 'episode', 2)],
        [
          { id: 't2', episodeNumber: 2 },
          { id: 't1', episodeNumber: 1 },
        ],
      ),
    ).toEqual([
      { from: 'e1', into: 't1' },
      { from: 'e2', into: 't2' },
    ])
  })

  test('absolute numbering: a local S01E13 becomes S02E01 (first target)', () => {
    expect(
      pairReplacedItems([local('e13', 'episode', 13)], [{ id: 's2e1', episodeNumber: 1 }]),
    ).toEqual([{ from: 'e13', into: 's2e1' }])
  })

  test('re-identification: a TMDB item keeps its history while it has another file', () => {
    const wrong = { ...local('wrong', 'movie'), tmdbId: 841 }
    expect(pairReplacedItems([wrong], [{ id: 'right' }])).toEqual([])
    // Left without any file: its rows follow the file (§7.8).
    expect(pairReplacedItems([wrong], [{ id: 'right' }], new Set(['wrong']))).toEqual([
      { from: 'wrong', into: 'right' },
    ])
  })

  test('episode span from the first episode decided', () => {
    expect(episodeSpan({ episode: 1, episodeEnd: 3 }, 5)).toEqual([5, 6, 7])
    expect(episodeSpan({ episode: 4 }, 4)).toEqual([4])
    expect(episodeSpan({ absoluteEpisode: 12, absoluteEpisodeEnd: 13 }, 12)).toEqual([12, 13])
    expect(episodeSpan({ episode: 1, episodeEnd: 40 }, 1)).toEqual([1])
    expect(episodeSpan({}, 2)).toEqual([2])
  })
})
