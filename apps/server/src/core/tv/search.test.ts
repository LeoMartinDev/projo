import { describe, expect, test } from 'bun:test'

import {
  matchesTvSearch,
  matchTvChannels,
  parseTvSearch,
  tvSearchTextOf,
  tvSearchWordsOf,
} from './search.ts'

describe('the TV search words (§29.6)', () => {
  test('ligatures spelled out, accents removed, lowercased, cut into letters and digits', () => {
    expect(tvSearchWordsOf("L'Été du Cœur — TF1|HD straße 20h30")).toEqual([
      'l',
      'ete',
      'du',
      'coeur',
      'tf1',
      'hd',
      'strasse',
      '20h30',
    ])
    expect(tvSearchWordsOf(' ?! ')).toEqual([])
  })

  test("a programme's text: its title's then its subtitle's words, each after a space", () => {
    expect(tvSearchTextOf({ title: 'Les Simpson', subtitle: 'Homer à Paris' })).toBe(
      ' les simpson homer a paris',
    )
    expect(tvSearchTextOf({ title: 'Météo' })).toBe(' meteo')
  })
})

describe('the TV search query', () => {
  test('its words, and the number it names when it is digits alone', () => {
    expect(parseTvSearch(' Fra 2 ')).toEqual({ words: ['fra', '2'] })
    expect(parseTvSearch('20')).toEqual({ words: ['20'], number: 20 })
    expect(parseTvSearch('éte')).toEqual({ words: ['ete'] })
  })

  test('below 2 characters, a channel number only', () => {
    expect(parseTvSearch('6')).toEqual({ words: [], number: 6 })
    expect(parseTvSearch('a')).toBeUndefined()
    expect(parseTvSearch('?!')).toBeUndefined()
  })

  test('every query word starts a word', () => {
    expect(matchesTvSearch(['france', '2'], ['fra', '2'])).toBe(true)
    expect(matchesTvSearch(['france', '24'], ['2'])).toBe(true)
    expect(matchesTvSearch(['france', '2'], ['ance'])).toBe(false)
    expect(matchesTvSearch(['france', '2'], ['fra', '3'])).toBe(false)
    expect(matchesTvSearch(['france'], [])).toBe(false)
  })
})

describe('the matching channels', () => {
  const channels = [
    { name: 'BFM TV', number: 15 },
    { name: 'La Chaîne Météo', number: 120 },
    { name: 'France 2', number: 2 },
    { name: '20 Minutes TV' },
    { name: 'Téva', number: 20 },
    { name: 'France 24' },
  ]
  const names = (query: string, limit?: number) =>
    matchTvChannels(channels, parseTvSearch(query) ?? { words: [] }, limit).map(
      (channel) => channel.name,
    )

  test('the number first, then the names starting with the first word, then the others', () => {
    expect(names('20')).toEqual(['Téva', '20 Minutes TV'])
    expect(names('tv')).toEqual(['BFM TV', '20 Minutes TV'])
    expect(names('2')).toEqual(['France 2'])
    expect(names('fra 2')).toEqual(['France 2', 'France 24'])
    expect(names('meteo')).toEqual(['La Chaîne Météo'])
    expect(names('chaine m')).toEqual(['La Chaîne Météo'])
  })

  test('accents and case ignored, never inside a word, at most the limit', () => {
    expect(names('TÉVA')).toEqual(['Téva'])
    expect(names('eva')).toEqual([])
    expect(names('f', 1)).toEqual([])
    expect(names('fr', 1)).toEqual(['France 2'])
  })
})
