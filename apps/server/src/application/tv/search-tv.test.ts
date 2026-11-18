import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import {
  matchesTvSearch,
  type TvSearchChannel,
  type TvSearchProgramme,
  type TvSearchReadModel,
  tvSearchWordsOf,
} from '../../core/tv/search.ts'
import { searchTvFactory } from './search-tv.ts'

const now = new Date('2026-11-18T20:00:00.000Z')
const minutes = (n: number) => new Date(now.getTime() + n * 60_000)

const channels: TvSearchChannel[] = [
  { id: 'tf1', name: 'TF1', number: 1, logoPath: 'tv/tf1.png' },
  { id: 'f2', name: 'France 2', number: 2 },
  { id: 'teva', name: 'Téva', number: 20 },
]

const programme = (
  id: string,
  channelId: string,
  title: string,
  from: number,
  to: number,
): TvSearchProgramme => ({
  id,
  channelId,
  title,
  kind: 'other',
  startAt: minutes(from),
  endAt: minutes(to),
})

/** The read model in memory: the matching rules of §29.6 over a fixed list. */
const inMemoryTvSearch = (programmes: TvSearchProgramme[]) => {
  const asked: { words: readonly string[]; at: Date; limit: number }[] = []
  const tvSearch: TvSearchReadModel = {
    viewableChannels: () => channels,
    matchingProgrammes: (input) => {
      asked.push(input)
      return programmes
        .filter(
          (p) =>
            p.endAt > input.at &&
            matchesTvSearch(tvSearchWordsOf(`${p.title} ${p.subtitle ?? ''}`), input.words),
        )
        .slice(0, input.limit)
    },
  }
  return { tvSearch, asked }
}

const world = (programmes: TvSearchProgramme[] = []) => {
  const { tvSearch, asked } = inMemoryTvSearch(programmes)
  const withoutLiveTv = new Set(['kid'])
  const search = searchTvFactory({
    tvSearch,
    tvAccess: { hasLiveTv: (profileId) => !withoutLiveTv.has(profileId) },
    clock: createManualClock(now),
  })
  return { search, asked }
}

describe('search TV (§29.6)', () => {
  test('matching channels and programmes, each programme with its channel', () => {
    const { search, asked } = world([
      programme('p1', 'f2', 'Télématin', -60, 30),
      programme('p2', 'gone', 'Télé-foot', 0, 60),
    ])
    const found = search({ query: 'tele', profileId: 'adult' })
    expect(found.channels).toEqual([])
    expect(found.programmes).toEqual([
      { programme: expect.objectContaining({ id: 'p1' }), channel: channels[1]! },
    ])
    expect(asked).toEqual([{ words: ['tele'], at: now, limit: 20 }])
  })

  test('a number typed alone finds its channel first; one digit, that channel only', () => {
    const { search, asked } = world([programme('p1', 'tf1', '20h30 le dimanche', 0, 30)])
    expect(search({ query: '20', profileId: 'adult' }).channels.map((c) => c.id)).toEqual(['teva'])
    expect(
      search({ query: '20', profileId: 'adult' }).programmes.map((p) => p.programme.id),
    ).toEqual(['p1'])
    expect(search({ query: '2', profileId: 'adult' })).toEqual({
      channels: [channels[1]!],
      programmes: [],
    })
    expect(asked.map((input) => input.words)).toEqual([['20'], ['20']])
  })

  test('accents and case ignored', () => {
    const { search } = world()
    expect(search({ query: 'TÉV', profileId: 'adult' }).channels.map((c) => c.id)).toEqual(['teva'])
  })

  test('a profile without Live TV access gets nothing, and nothing is read', () => {
    const { search, asked } = world([programme('p1', 'f2', 'Télématin', -60, 30)])
    expect(search({ query: 'tele', profileId: 'kid' })).toEqual({ channels: [], programmes: [] })
    expect(search({ query: 'fr', profileId: 'kid' })).toEqual({ channels: [], programmes: [] })
    expect(asked).toEqual([])
  })

  test('a query without a word nor a number finds nothing', () => {
    const { search, asked } = world()
    expect(search({ query: '?!', profileId: 'adult' })).toEqual({ channels: [], programmes: [] })
    expect(search({ query: 'a', profileId: 'adult' })).toEqual({ channels: [], programmes: [] })
    expect(asked).toEqual([])
  })
})
