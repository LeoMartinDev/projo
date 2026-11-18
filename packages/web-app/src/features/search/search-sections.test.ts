import { describe, expect, test } from 'bun:test'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { SearchProgrammeDto } from '@projo/shared/api/search'

import { channelLabel, isOnAir, searchSections } from './search-sections.ts'

const movie: ItemSummaryDto = {
  id: 'm',
  kind: 'movie',
  title: 'Amélie',
  sortTitle: 'amelie',
  images: {},
  genres: [],
}
const channel = { id: 'c', name: 'Téva', number: 20 }
const programme: SearchProgrammeDto = {
  id: 'p',
  title: 'Le journal',
  kind: 'news',
  startAt: '2026-11-18T20:00:00.000Z',
  endAt: '2026-11-18T20:30:00.000Z',
  channel,
}

describe('the search sections (§29.6)', () => {
  test('movies, shows, channels, programmes, in that order', () => {
    const sections = searchSections({
      movies: [movie],
      series: [],
      channels: [channel],
      programmes: [programme],
    })
    expect(sections.map((section) => section.id)).toEqual([
      'movies',
      'series',
      'channels',
      'programmes',
    ])
    expect(sections.map((section) => section.entries)).toEqual([
      [{ kind: 'item', item: movie }],
      [],
      [{ kind: 'channel', channel }],
      [{ kind: 'programme', programme }],
    ])
  })

  test('a server without the TV sections gives them empty', () => {
    expect(
      searchSections({ movies: [], series: [movie] }).map((section) => section.entries.length),
    ).toEqual([0, 1, 0, 0])
  })

  test('on air from its start, until its end', () => {
    const at = (iso: string) => Date.parse(iso)
    expect(isOnAir(programme, at('2026-11-18T19:59:59.000Z'))).toBe(false)
    expect(isOnAir(programme, at('2026-11-18T20:00:00.000Z'))).toBe(true)
    expect(isOnAir(programme, at('2026-11-18T20:29:59.000Z'))).toBe(true)
    expect(isOnAir(programme, at('2026-11-18T20:30:00.000Z'))).toBe(false)
  })

  test('a channel: its number, then its name', () => {
    expect(channelLabel(channel)).toBe('20 Téva')
    expect(channelLabel({ name: 'Arte' })).toBe('Arte')
  })
})
