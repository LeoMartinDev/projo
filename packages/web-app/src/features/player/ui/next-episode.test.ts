import { describe, expect, test } from 'bun:test'

import {
  episodeCards,
  episodeNumberLabel,
  nextEpisodeOf,
  nextInSeason,
  nextSeason,
} from './next-episode.ts'

describe('next episode', () => {
  const episode = (id: string, episodeNumber: number) => ({ id, seasonNumber: 1, episodeNumber })
  const season = (id: string, seasonNumber: number) => ({ id, seasonNumber })

  test('the following episode of the season, whatever the list order', () => {
    const episodes = [episode('e3', 3), episode('e1', 1), episode('e2', 2)]
    expect(nextInSeason(episodes, 'e1')?.id).toBe('e2')
    expect(nextInSeason(episodes, 'e3')).toBeUndefined()
    expect(nextInSeason(episodes, 'nope')).toBeUndefined()
  })

  test('else the next season; nothing after the specials', () => {
    const seasons = [season('s2', 2), season('s0', 0), season('s1', 1)]
    expect(nextSeason(seasons, 1)?.id).toBe('s2')
    expect(nextSeason(seasons, 2)).toBeUndefined()
    expect(nextSeason(seasons, 0)).toBeUndefined()
  })

  test('combined: last of a season leads to the first of the next one', () => {
    const lists = {
      episodes: [episode('e1', 1), episode('e2', 2)],
      seasons: [season('s1', 1), season('s2', 2)],
      nextSeasonEpisodes: [episode('f2', 2), episode('f1', 1)],
    }
    expect(nextEpisodeOf({ currentId: 'e1', seasonNumber: 1, ...lists })).toEqual({
      status: 'found',
      episode: lists.episodes[1]!,
    })
    expect(nextEpisodeOf({ currentId: 'e2', seasonNumber: 1, ...lists })).toEqual({
      status: 'found',
      episode: lists.nextSeasonEpisodes[1]!,
    })
    expect(
      nextEpisodeOf({ currentId: 'e2', seasonNumber: 1, ...lists, nextSeasonEpisodes: undefined }),
    ).toEqual({ status: 'loading' })
    expect(
      nextEpisodeOf({ currentId: 'e2', seasonNumber: 2, ...lists, seasons: [season('s2', 2)] }),
    ).toEqual({ status: 'none' })
  })

  test('a multi-episode file (§8.4): one card "1-2", the next one skips what it holds', () => {
    const episodes = [
      episode('e3', 3),
      { ...episode('e1', 1), episodeNumberEnd: 2 },
      episode('e2', 2),
      { ...episode('e4', 4), episodeNumberEnd: 6 },
      episode('e5', 5),
      episode('e6', 6),
    ]
    expect(episodeCards(episodes).map((card) => card.id)).toEqual(['e1', 'e3', 'e4'])
    expect(episodeCards(episodes).map(episodeNumberLabel)).toEqual(['1-2', '3', '4-6'])
    expect(episodeNumberLabel({ id: 'x', seasonNumber: 1 })).toBeUndefined()
    expect(nextInSeason(episodes, 'e1')?.id).toBe('e3')
    expect(nextInSeason(episodes, 'e2')?.id).toBe('e3')
    expect(nextInSeason(episodes, 'e5')).toBeUndefined()
  })
})
