import { describe, expect, test } from 'bun:test'

import { linkTargetsFor, pickLocalCandidate } from './item-linking.ts'

describe('linkTargetsFor (M1 local items)', () => {
  test('movie, with the part label restored when the file is not stacked', () => {
    expect(
      linkTargetsFor({ classification: 'movie', parsed: { title: 'Inception', year: 2010 } }),
    ).toEqual([{ kind: 'movie', title: 'Inception', year: 2010 }])
    const part = { index: 1, label: 'Part 1' }
    expect(
      linkTargetsFor({ classification: 'movie', parsed: { title: 'Deathly Hallows', part } }),
    ).toEqual([{ kind: 'movie', title: 'Deathly Hallows Part 1' }])
    expect(
      linkTargetsFor({
        classification: 'movie',
        parsed: { title: 'Deathly Hallows', part },
        stackGroupId: 'g',
      }),
    ).toEqual([{ kind: 'movie', title: 'Deathly Hallows' }])
  })

  test('episodes: one target per episode of a multi-episode file, season 1 by default', () => {
    expect(
      linkTargetsFor({
        classification: 'episode',
        parsed: {
          series: 'Dexter',
          season: 4,
          episode: 1,
          episodeEnd: 2,
          episodeTitle: 'Living the Dream',
        },
      }).map((t) =>
        t.kind === 'episode' ? `${t.series.title} S${t.seasonNumber}E${t.episodeNumber}` : t.title,
      ),
    ).toEqual(['Dexter S4E1', 'Dexter S4E2'])
    expect(
      linkTargetsFor({
        classification: 'episode',
        parsed: { series: 'Naruto', absoluteEpisode: 12 },
      }),
    ).toMatchObject([{ seasonNumber: 1, episodeNumber: 12 }])
  })

  test('nothing for unknowns, date-based episodes and absurd ranges', () => {
    expect(linkTargetsFor({ classification: 'unknown', parsed: { title: 'x' } })).toEqual([])
    expect(
      linkTargetsFor({
        classification: 'episode',
        parsed: { series: 'News', airDate: '2017-04-20' },
      }),
    ).toEqual([])
    expect(
      linkTargetsFor({
        classification: 'episode',
        parsed: { series: 'X', season: 1, episode: 1, episodeEnd: 80 },
      }),
    ).toHaveLength(1)
  })
})

describe('pickLocalCandidate', () => {
  const noYear = { id: 'a' }
  const y2005 = { id: 'b', year: 2005 }
  const y1963 = { id: 'c', year: 1963 }
  test('same year first, then a year-less item; different years never merge', () => {
    expect(pickLocalCandidate([noYear, y2005], 2005)).toEqual(y2005)
    expect(pickLocalCandidate([noYear], 2005)).toEqual(noYear)
    expect(pickLocalCandidate([y1963], 2005)).toBeUndefined()
    expect(pickLocalCandidate([y2005], undefined)).toEqual(y2005)
    expect(pickLocalCandidate([y2005, y1963], undefined)).toBeUndefined()
    expect(pickLocalCandidate([y2005, noYear], undefined)).toEqual(noYear)
  })
})
