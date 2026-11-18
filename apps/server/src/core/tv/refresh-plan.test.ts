import { describe, expect, test } from 'bun:test'

import type { TvChannel, TvGroup } from './channel.ts'
import type { TvProviderChannel } from './provider.ts'
import { planTvRefresh } from './refresh-plan.ts'

const now = new Date('2026-06-10T10:00:00.000Z')
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000)

const listed = (name: string, group: string, extra: Partial<TvProviderChannel> = {}) => ({
  key: `name:${group}|${name}`,
  name,
  group,
  upstream: { url: `http://p/${name}.ts` },
  ...extra,
})

const newIds = () => {
  let counter = 0
  return () => {
    counter += 1
    return `new-${counter}`
  }
}

const group = (id: string, name: string, enabled: boolean, position = 0): TvGroup => ({
  id,
  sourceId: 's1',
  name,
  enabled,
  position,
})

const channel = (
  id: string,
  name: string,
  groupId: string,
  groupName: string,
  extra: Partial<TvChannel> = {},
): TvChannel => ({
  id,
  sourceId: 's1',
  key: `name:${groupName}|${name}`,
  name,
  groupId,
  position: 0,
  upstream: { url: `http://p/${name}.ts` },
  enabled: false,
  createdAt: daysAgo(30),
  ...extra,
})

/** Applies a plan to in-memory state, like the repository does. */
const apply = (
  state: { groups: TvGroup[]; channels: TvChannel[] },
  plan: ReturnType<typeof planTvRefresh>,
) => {
  const groups = [
    ...state.groups
      .filter((g) => !plan.groups.delete.includes(g.id))
      .map((g) => ({
        ...g,
        position: plan.groups.update.find((u) => u.id === g.id)?.position ?? g.position,
      })),
    ...plan.groups.insert,
  ]
  const channels = [
    ...state.channels
      .filter((c) => !plan.channels.delete.includes(c.id))
      .map((c): TvChannel => {
        const update = plan.channels.update.find((u) => u.id === c.id)
        if (update !== undefined) {
          const { missingSince: _gone, number: _n, guideKey: _g, logoUrl: _l, ...rest } = c
          return {
            ...rest,
            ...update,
            ...(update.number === undefined ? {} : { number: update.number }),
            ...(update.guideKey === undefined ? {} : { guideKey: update.guideKey }),
            ...(update.logoUrl === undefined ? {} : { logoUrl: update.logoUrl }),
          } as TvChannel
        }
        return plan.channels.markMissing.ids.includes(c.id)
          ? { ...c, missingSince: plan.channels.markMissing.at }
          : c
      }),
    ...plan.channels.insert,
  ]
  return { groups, channels }
}

describe('planTvRefresh', () => {
  test('a first refresh creates the groups and their channels, all disabled', () => {
    const plan = planTvRefresh({
      sourceId: 's1',
      groups: [],
      channels: [],
      listing: [listed('A', 'News'), listed('B', ''), listed('C', 'News')],
      now,
      newId: newIds(),
    })
    expect(plan.groups.insert).toEqual([
      group('new-1', 'News', false, 0),
      group('new-3', '', false, 1),
    ])
    expect(
      plan.channels.insert.map((c) => [c.id, c.name, c.groupId, c.position, c.enabled]),
    ).toEqual([
      ['new-2', 'A', 'new-1', 0, false],
      ['new-4', 'B', 'new-3', 1, false],
      ['new-5', 'C', 'new-1', 2, false],
    ])
  })

  test('a channel keeps its id and enabled flag across refreshes, its fields follow the source', () => {
    const groups = [group('g1', 'News', false)]
    const channels = [channel('c1', 'A', 'g1', 'News', { enabled: true, number: 3 })]
    const plan = planTvRefresh({
      sourceId: 's1',
      groups,
      channels,
      listing: [
        listed('A', 'News', {
          number: 4,
          logoUrl: 'http://l/a.png',
          upstream: { url: 'http://new/a.ts' },
        }),
      ],
      now,
      newId: newIds(),
    })
    expect(plan.channels.insert).toEqual([])
    expect(plan.channels.update).toEqual([
      {
        id: 'c1',
        name: 'A',
        number: 4,
        groupId: 'g1',
        position: 0,
        upstream: { url: 'http://new/a.ts' },
        guideKey: undefined,
        logoUrl: 'http://l/a.png',
      },
    ])
    const after = apply({ groups, channels }, plan)
    expect(after.channels).toMatchObject([{ id: 'c1', enabled: true, number: 4 }])
  })

  test('an unchanged channel is not written', () => {
    const groups = [group('g1', 'News', false)]
    const channels = [channel('c1', 'A', 'g1', 'News')]
    const plan = planTvRefresh({
      sourceId: 's1',
      groups,
      channels,
      listing: [listed('A', 'News')],
      now,
      newId: newIds(),
    })
    expect(plan.channels.update).toEqual([])
    expect(plan.groups).toEqual({ insert: [], update: [], delete: [] })
  })

  test('a new channel in an enabled group is enabled, in a disabled one disabled', () => {
    const plan = planTvRefresh({
      sourceId: 's1',
      groups: [group('g1', 'News', true, 0), group('g2', 'Kids', false, 1)],
      channels: [],
      listing: [listed('A', 'News'), listed('B', 'Kids')],
      now,
      newId: newIds(),
    })
    expect(plan.channels.insert.map((c) => [c.name, c.enabled])).toEqual([
      ['A', true],
      ['B', false],
    ])
  })

  test('a channel moving to another group keeps its id and enabled flag', () => {
    const groups = [group('g1', 'News', false, 0)]
    const channels = [
      channel('c1', 'A', 'g1', 'News', { key: 'tvg:a|A', guideKey: 'a', enabled: true }),
    ]
    const plan = planTvRefresh({
      sourceId: 's1',
      groups,
      channels,
      listing: [{ ...listed('A', 'Info'), key: 'tvg:a|A', guideKey: 'a' }],
      now,
      newId: newIds(),
    })
    expect(plan.groups.insert).toEqual([group('new-1', 'Info', false, 0)])
    expect(plan.groups.delete).toEqual(['g1'])
    expect(plan.channels.update).toMatchObject([{ id: 'c1', groupId: 'new-1' }])
  })

  test('a channel gone is marked missing, kept 7 days with its group, then deleted', () => {
    const groups = [group('g1', 'News', true, 0), group('g2', 'Kids', false, 1)]
    const channels = [
      channel('c1', 'A', 'g1', 'News', { enabled: true }),
      channel('c2', 'B', 'g2', 'Kids'),
    ]
    const first = planTvRefresh({
      sourceId: 's1',
      groups,
      channels,
      listing: [listed('A', 'News')],
      now: daysAgo(7),
      newId: newIds(),
    })
    expect(first.channels.markMissing).toEqual({ ids: ['c2'], at: daysAgo(7) })
    expect(first.groups.delete).toEqual([])
    const missing = apply({ groups, channels }, first)

    const sixDays = planTvRefresh({
      sourceId: 's1',
      ...missing,
      listing: [listed('A', 'News')],
      now: daysAgo(1),
      newId: newIds(),
    })
    expect(sixDays.channels).toMatchObject({ markMissing: { ids: [] }, delete: [] })

    const sevenDays = planTvRefresh({
      sourceId: 's1',
      ...missing,
      listing: [listed('A', 'News')],
      now,
      newId: newIds(),
    })
    expect(sevenDays.channels.delete).toEqual(['c2'])
    expect(sevenDays.groups.delete).toEqual(['g2'])
  })

  test('a channel back before 7 days keeps its id and flag and is no longer missing', () => {
    const groups = [group('g1', 'News', false)]
    const channels = [channel('c1', 'A', 'g1', 'News', { enabled: true, missingSince: daysAgo(3) })]
    const plan = planTvRefresh({
      sourceId: 's1',
      groups,
      channels,
      listing: [listed('A', 'News')],
      now,
      newId: newIds(),
    })
    expect(plan.channels.update.map((u) => u.id)).toEqual(['c1'])
    const after = apply({ groups, channels }, plan)
    expect(after.channels[0]).toMatchObject({ id: 'c1', enabled: true })
    expect(after.channels[0]?.missingSince).toBeUndefined()
  })

  test('a key listed twice keeps its first entry', () => {
    const plan = planTvRefresh({
      sourceId: 's1',
      groups: [],
      channels: [],
      listing: [
        listed('A', 'News', { key: 'k' }),
        listed('A copy', 'All', { key: 'k' }),
        listed('B', 'News'),
      ],
      now,
      newId: newIds(),
    })
    expect(plan.channels.insert.map((c) => [c.name, c.position])).toEqual([
      ['A', 0],
      ['B', 1],
    ])
    expect(plan.groups.insert.map((g) => g.name)).toEqual(['News'])
  })

  test('groups follow the playlist order', () => {
    const plan = planTvRefresh({
      sourceId: 's1',
      groups: [group('g1', 'News', false, 0), group('g2', 'Kids', false, 1)],
      channels: [
        channel('c1', 'A', 'g1', 'News'),
        channel('c2', 'B', 'g2', 'Kids', { position: 1 }),
      ],
      listing: [listed('B', 'Kids'), listed('A', 'News')],
      now,
      newId: newIds(),
    })
    expect(plan.groups.update).toEqual([
      { id: 'g2', position: 0 },
      { id: 'g1', position: 1 },
    ])
  })
})
