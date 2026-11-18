import { describe, expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

const createdAt = new Date('2026-06-01T00:00:00.000Z')
const at = (time: string) => new Date(`2026-06-10T${time}:00.000Z`)

const seeded = () => {
  const world = createTvWorld()
  const { groups, channels } = world.channels
  groups.set('news', { id: 'news', sourceId: 's', name: 'News', enabled: true, position: 1 })
  groups.set('kids', { id: 'kids', sourceId: 's', name: 'Kids', enabled: false, position: 0 })
  groups.set('empty', { id: 'empty', sourceId: 's', name: '', enabled: true, position: 2 })
  const channel = (id: string, groupId: string, position: number, more = {}) =>
    channels.set(id, {
      id,
      sourceId: 's',
      key: id,
      name: id,
      groupId,
      position,
      upstream: { url: `http://provider.test/${id}` },
      enabled: true,
      createdAt,
      ...more,
    })
  channel('n2', 'news', 3)
  channel('n1', 'news', 2)
  channel('k1', 'kids', 1)
  channel('off', 'empty', 4, { enabled: false })
  channel('gone', 'empty', 5, { missingSince: createdAt })
  return world
}

describe('listTvChannels (§29.7)', () => {
  test('every enabled, present channel in group then playlist order, with its groups', () => {
    const listed = seeded().listTvChannels({ profileId: 'p' })
    expect(listed.groups.map((group) => group.id)).toEqual(['kids', 'news'])
    expect(listed.channels.map((c) => c.id)).toEqual(['k1', 'n1', 'n2'])
  })

  test("the profile's favourites in the order added, those it no longer sees left out", () => {
    const world = seeded()
    for (const channelId of ['n2', 'off', 'k1'])
      world.favorites.repository.add({ profileId: 'p', channelId, at: createdAt })
    world.favorites.repository.add({ profileId: 'other', channelId: 'n1', at: createdAt })
    expect(world.listTvChannels({ profileId: 'p' }).favorites).toEqual(['n2', 'k1'])
  })

  test('now and next of each channel at the time asked (§29.3)', () => {
    const world = seeded()
    world.clock.set(at('10:30'))
    const programme = (channelId: string, start: string, end: string, title: string) => ({
      channelId,
      startAt: at(start),
      endAt: at(end),
      title,
    })
    world.guide.repository.replaceForSource({
      sourceId: 's',
      now: at('10:30'),
      programmes: [
        programme('n1', '10:00', '11:00', 'Morning'),
        programme('n1', '11:00', '12:00', 'Noon'),
        programme('n1', '12:00', '13:00', 'Afternoon'),
        programme('k1', '11:00', '11:30', 'Cartoons'),
      ],
    })
    const { guide } = world.listTvChannels({ profileId: 'p' })
    expect(guide.get('n1')?.now?.title).toBe('Morning')
    expect(guide.get('n1')?.next?.title).toBe('Noon')
    expect(guide.get('k1')?.now).toBeUndefined()
    expect(guide.get('k1')?.next?.title).toBe('Cartoons')
    expect(guide.has('n2')).toBe(false)
    expect(world.listTvGuide({ profileId: 'p' }).get('n1')?.now?.title).toBe('Morning')
  })

  test('a profile without Live TV access sees no channel nor guide (§29.6)', () => {
    const world = seeded()
    world.withoutLiveTv.add('p')
    expect(world.listTvChannels({ profileId: 'p' })).toMatchObject({
      groups: [],
      channels: [],
      favorites: [],
    })
    expect(world.listTvGuide({ profileId: 'p' }).size).toBe(0)
    expect(world.listTvChannels({ profileId: 'other' }).channels).toHaveLength(3)
  })
})

describe('favourites (§29.7)', () => {
  test('added last, kept in place when added again, removed; idempotent removal', () => {
    const world = seeded()
    expect(world.addTvFavorite({ profileId: 'p', channelId: 'n1' }).ok).toBe(true)
    expect(world.addTvFavorite({ profileId: 'p', channelId: 'k1' }).ok).toBe(true)
    expect(world.addTvFavorite({ profileId: 'p', channelId: 'n1' }).ok).toBe(true)
    expect(world.listTvChannels({ profileId: 'p' }).favorites).toEqual(['n1', 'k1'])
    expect(world.removeTvFavorite({ profileId: 'p', channelId: 'n1' }).ok).toBe(true)
    expect(world.removeTvFavorite({ profileId: 'p', channelId: 'n1' }).ok).toBe(true)
    expect(world.listTvChannels({ profileId: 'p' }).favorites).toEqual(['k1'])
  })

  test('a channel the profile does not see is not found: disabled, gone, unknown, no access', () => {
    const world = seeded()
    for (const channelId of ['off', 'gone', 'nope']) {
      expect(world.addTvFavorite({ profileId: 'p', channelId })).toMatchObject({
        ok: false,
        error: { code: 'tv/channel_not_found' },
      })
    }
    world.addTvFavorite({ profileId: 'p', channelId: 'n1' })
    world.withoutLiveTv.add('p')
    expect(world.addTvFavorite({ profileId: 'p', channelId: 'n2' })).toMatchObject({
      ok: false,
      error: { code: 'tv/channel_not_found' },
    })
    expect(world.removeTvFavorite({ profileId: 'p', channelId: 'n1' }).ok).toBe(false)
    // Kept for when access comes back.
    world.withoutLiveTv.delete('p')
    expect(world.listTvChannels({ profileId: 'p' }).favorites).toEqual(['n1'])
  })
})
