import { describe, expect, test } from 'bun:test'

import type { TvChannelsResponse, TvProgrammeKind } from '@projo/shared/api/tv'

import {
  channelOrder,
  channelSections,
  elapsedOf,
  onAirAt,
  onNowRows,
  withFavorite,
  withFavoriteOf,
  withGuide,
} from './queries.ts'

const response: TvChannelsResponse = {
  groups: [
    { id: 'g-news', name: 'News' },
    { id: 'g-other', name: '' },
    { id: 'g-empty', name: 'Empty' },
  ],
  items: [
    { id: 'c1', name: 'News One', number: 1, groupId: 'g-news' },
    { id: 'c3', name: 'Local', groupId: 'g-other' },
    { id: 'c2', name: 'News Two', groupId: 'g-news' },
  ],
}

const sectionsOf = (value: TvChannelsResponse) =>
  channelSections(value).map(({ id, channels }) => [id, channels.map((channel) => channel.id)])

describe('TV page (§29.6)', () => {
  test('one section per group in order, a group without channel left out', () => {
    expect(sectionsOf(response)).toEqual([
      ['group:g-news', ['c1', 'c2']],
      ['group:g-other', ['c3']],
    ])
  })

  test('favourites first in the order added, each channel once; zapping follows', () => {
    const starred = withFavorite(withFavorite(response, 'c3', true), 'c2', true)
    expect(sectionsOf(starred)).toEqual([
      ['favorites', ['c3', 'c2']],
      ['group:g-news', ['c1']],
    ])
    expect(channelOrder(starred)).toEqual(['c3', 'c2', 'c1'])
    const unstarred = withFavorite(starred, 'c3', false)
    expect(unstarred.favorites).toEqual(['c2'])
    expect(unstarred.items.find((c) => c.id === 'c3')?.favorite).toBe(false)
    expect(channelOrder(unstarred)).toEqual(['c2', 'c1', 'c3'])
  })

  test('a failed star puts back its own channel only, in its place', () => {
    const before = withFavorite(withFavorite(response, 'c3', true), 'c2', true)
    // c3 unstarred (it will fail), then c1 starred (it succeeds).
    const current = withFavorite(withFavorite(before, 'c3', false), 'c1', true)
    const reverted = withFavoriteOf(current, before, 'c3')
    expect(reverted.favorites).toEqual(['c3', 'c2', 'c1'])
    expect(reverted.items.find((c) => c.id === 'c3')?.favorite).toBe(true)
    expect(reverted.items.find((c) => c.id === 'c1')?.favorite).toBe(true)
    // A failed star of a channel that was not a favourite takes it out again.
    const starred = withFavorite(withFavorite(before, 'c1', true), 'c2', false)
    const undone = withFavoriteOf(starred, before, 'c1')
    expect(undone.favorites).toEqual(['c3'])
    expect(undone.items.find((c) => c.id === 'c1')?.favorite).toBe(false)
  })

  test('an older server without the favourites list: the flagged channels', () => {
    const flagged: TvChannelsResponse = {
      ...response,
      items: response.items.map((c) => (c.id === 'c2' ? { ...c, favorite: true } : c)),
    }
    expect(channelOrder(flagged)).toEqual(['c2', 'c1', 'c3'])
  })

  test('zapping follows the sections', () => {
    expect(channelOrder(response)).toEqual(['c1', 'c2', 'c3'])
  })
})

const programme = (title: string, start: string, end: string) => ({
  title,
  startAt: `2026-06-10T${start}:00.000Z`,
  endAt: `2026-06-10T${end}:00.000Z`,
})
const at = (time: string) => new Date(`2026-06-10T${time}:00.000Z`).getTime()

describe('guide on the page (§29.6)', () => {
  test('the latest read replaces now and next; a channel it lacks loses them', () => {
    const listed = {
      ...response,
      items: response.items.map((c) => ({ ...c, now: programme('Old', '10:00', '11:00') })),
    }
    const merged = withGuide(listed, {
      items: [{ channelId: 'c1', now: programme('New', '10:30', '11:30') }],
    })
    expect(merged.items.map((c) => c.now?.title)).toEqual(['New', undefined, undefined])
    expect(withGuide(listed, undefined)).toBe(listed)
  })

  test('between two reads, an ended programme gives way to the next one', () => {
    const channel = {
      now: programme('Now', '10:00', '11:00'),
      next: programme('Next', '11:00', '12:00'),
    }
    expect(onAirAt(channel, at('10:30'))).toEqual(channel)
    expect(onAirAt(channel, at('11:10'))).toEqual({ now: channel.next })
    expect(onAirAt(channel, at('12:10'))).toEqual({})
    const gap = {
      now: programme('Now', '10:00', '11:00'),
      next: programme('Later', '11:30', '12:00'),
    }
    expect(onAirAt(gap, at('11:10'))).toEqual({ next: gap.next })
    expect(onAirAt({ next: gap.next }, at('11:10'))).toEqual({ next: gap.next })
  })

  test('elapsed part, bounded', () => {
    const show = programme('Show', '10:00', '11:00')
    expect(elapsedOf(show, at('10:15'))).toBe(0.25)
    expect(elapsedOf(show, at('09:00'))).toBe(0)
    expect(elapsedOf(show, at('12:00'))).toBe(1)
  })
})

describe('"On now" rows (§29.6)', () => {
  const on = (title: string, kind: TvProgrammeKind) => ({
    ...programme(title, '10:00', '11:00'),
    id: title,
    kind,
  })
  const listed: TvChannelsResponse = {
    groups: [
      { id: 'g1', name: 'General' },
      { id: 'g2', name: 'Sports' },
    ],
    items: [
      { id: 'a', name: 'A', groupId: 'g1', kind: 'other', now: on('Film A', 'movie') },
      { id: 'b', name: 'B', groupId: 'g1', kind: 'other', now: on('Journal', 'news') },
      { id: 's1', name: 'Sport 1', groupId: 'g2', kind: 'sport' },
      { id: 's2', name: 'Sport 2', groupId: 'g2', kind: 'sport', now: on('Match', 'sport') },
      { id: 'c', name: 'C', groupId: 'g1', kind: 'other' },
      { id: 'd', name: 'D', groupId: 'g1', kind: 'movie', now: on('Film D', 'movie') },
      { id: 'e', name: 'E', groupId: 'g1', kind: 'other', now: on('Quiz', 'other') },
    ],
    favorites: ['d'],
  }
  const rowsAt = (value: TvChannelsResponse, time: string) =>
    onNowRows(value, at(time)).map(({ kind, cards }) => [
      kind,
      cards.map((card) => `${card.channel.id}:${card.programme?.title ?? '-'}`),
    ])

  test('one row per kind in order, page order inside (favourites first), empty rows left out', () => {
    expect(rowsAt(listed, '10:30')).toEqual([
      ['movie', ['d:Film D', 'a:Film A']],
      ['sport', ['s1:-', 's2:Match']],
      ['news', ['b:Journal']],
      ['other', ['e:Quiz']],
    ])
  })

  test('a channel without a programme on now shows under its own kind, never under other', () => {
    // At 11:30 nothing is on: only the channels whose own kind is not `other` stay.
    expect(rowsAt(listed, '11:30')).toEqual([
      ['movie', ['d:-']],
      ['sport', ['s1:-', 's2:-']],
    ])
  })

  test('a server without kinds gives no row', () => {
    const old: TvChannelsResponse = {
      groups: [{ id: 'g', name: '' }],
      items: [{ id: 'x', name: 'X', groupId: 'g', now: programme('Old', '10:00', '11:00') }],
    }
    expect(onNowRows(old, at('10:30'))).toEqual([])
  })
})
