import { describe, expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

const createdAt = new Date('2026-06-01T00:00:00.000Z')
const at = (time: string) => new Date(`2026-06-10T${time}:00.000Z`)

const seeded = () => {
  const world = createTvWorld()
  const { groups, channels } = world.channels
  groups.set('g', { id: 'g', sourceId: 's', name: 'News', enabled: true, position: 0 })
  const channel = (id: string, more = {}) =>
    channels.set(id, {
      id,
      sourceId: 's',
      key: id,
      name: id,
      groupId: 'g',
      position: channels.size,
      upstream: { url: `http://provider.test/${id}` },
      enabled: true,
      createdAt,
      ...more,
    })
  channel('a')
  channel('b')
  channel('off', { enabled: false })
  channel('gone', { missingSince: createdAt })
  const programme = (channelId: string, start: string, end: string, title: string) => ({
    channelId,
    startAt: at(start),
    endAt: at(end),
    title,
    description: 'Not in the grid',
    categories: [],
    kind: 'news' as const,
  })
  world.guide.repository.replaceForSource({
    sourceId: 's',
    now: at('10:00'),
    programmes: [
      programme('a', '12:00', '13:00', 'A noon'),
      programme('a', '09:00', '10:00', 'A morning'),
      programme('a', '10:00', '12:00', 'A late morning'),
      programme('a', '13:00', '14:00', 'A afternoon'),
      { ...programme('b', '10:30', '11:00', 'B'), episode: { season: 2, episode: 5 } },
      programme('off', '10:00', '11:00', 'Off'),
      programme('gone', '10:00', '11:00', 'Gone'),
    ],
  })
  return world
}

const titles = (entries: ReturnType<ReturnType<typeof createTvWorld>['listTvSchedule']>) =>
  entries.map((entry) => [entry.channelId, entry.programmes.map((p) => p.title)])

describe('listTvSchedule (§29.7)', () => {
  test('the programmes overlapping the range, channels in the order asked, each by start', () => {
    const listed = seeded().listTvSchedule({
      profileId: 'p',
      channelIds: ['b', 'a', 'b'],
      from: at('10:00'),
      to: at('13:00'),
    })
    // Overlapping [10:00, 13:00): the morning ends at 10:00, the afternoon starts at 13:00.
    expect(titles(listed)).toEqual([
      ['b', ['B']],
      ['a', ['A late morning', 'A noon']],
    ])
    expect(listed[0]?.programmes[0]).toEqual({
      id: expect.any(String),
      channelId: 'b',
      startAt: at('10:30'),
      endAt: at('11:00'),
      title: 'B',
      kind: 'news',
      episode: { season: 2, episode: 5 },
    })
  })

  test('a programme cut by either end of the range is listed', () => {
    const listed = seeded().listTvSchedule({
      profileId: 'p',
      channelIds: ['a'],
      from: at('11:00'),
      to: at('12:30'),
    })
    expect(titles(listed)).toEqual([['a', ['A late morning', 'A noon']]])
  })

  test('channels the profile does not see, or without programmes there, are left out', () => {
    const world = seeded()
    const ask = (profileId: string) =>
      world.listTvSchedule({
        profileId,
        channelIds: ['off', 'gone', 'unknown', 'b', 'a'],
        from: at('11:00'),
        to: at('11:30'),
      })
    expect(titles(ask('p'))).toEqual([['a', ['A late morning']]])
    world.withoutLiveTv.add('p')
    expect(ask('p')).toEqual([])
  })
})
