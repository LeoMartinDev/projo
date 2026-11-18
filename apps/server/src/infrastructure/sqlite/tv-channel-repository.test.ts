import { beforeEach, describe, expect, test } from 'bun:test'

import { createTestDatabase } from '../../../test/support/database.ts'
import type {
  TvChannel,
  TvChannelRepository,
  TvGroup,
  TvRefreshPlan,
} from '../../core/tv/channel.ts'
import { searchNameOf } from '../../core/tv/channel.ts'
import { createSqliteTvChannelRepository } from './tv-channel-repository.ts'
import { createSqliteTvSourceRepository } from './tv-source-repository.ts'

const now = new Date('2026-06-10T10:00:00.000Z')
const hour = 60 * 60_000
const at = (hours: number) => new Date(now.getTime() + hours * hour)

const group = (id: string, name: string, position = 0): TvGroup => ({
  id,
  sourceId: 's1',
  name,
  enabled: false,
  position,
})

const channel = (id: string, name: string, extra: Partial<TvChannel> = {}): TvChannel => ({
  id,
  sourceId: 's1',
  key: id,
  name,
  groupId: 'g1',
  position: 0,
  upstream: { url: `http://p/${id}.ts` },
  enabled: true,
  createdAt: now,
  ...extra,
})

const plan = (parts: {
  groups?: Partial<TvRefreshPlan['groups']>
  channels?: Partial<Omit<TvRefreshPlan['channels'], 'markMissing'>> & { missing?: string[] }
}): TvRefreshPlan => ({
  sourceId: 's1',
  groups: { insert: [], update: [], delete: [], ...parts.groups },
  channels: {
    insert: parts.channels?.insert ?? [],
    update: parts.channels?.update ?? [],
    markMissing: { ids: parts.channels?.missing ?? [], at: now },
    delete: parts.channels?.delete ?? [],
  },
})

let repository: TvChannelRepository
const stored = (id: string): TvChannel => {
  const found = repository.findChannel(id)
  if (found === undefined) throw new Error(`no channel ${id}`)
  return found
}
const fetchIds = (hoursLater: number) =>
  repository
    .logoWork({ sourceId: 's1', retryFailedBefore: at(hoursLater - 24) })
    .fetch.map((c) => c.id)

beforeEach(() => {
  const db = createTestDatabase()
  createSqliteTvSourceRepository({ db }).save({
    id: 's1',
    name: 'Box',
    settings: { kind: 'm3u', playlistUrl: 'http://p/list.m3u' },
    createdAt: now,
    failureCount: 0,
  })
  repository = createSqliteTvChannelRepository({ db })
  repository.applyRefresh(
    plan({
      groups: { insert: [group('g1', 'News')] },
      channels: {
        insert: [
          channel('a', 'Télé Matin', { position: 0, logoUrl: 'http://l/a.png' }),
          channel('b', '100% Musique', { position: 1, logoUrl: 'http://l/b.png' }),
          channel('c', 'Canal_Plus', { position: 2, logoUrl: 'http://l/c.png', enabled: false }),
          channel('d', 'Canal Plus', { position: 3 }),
        ],
      },
    }),
  )
})

describe('logo work (§29.2)', () => {
  test('a fetched logo is not fetched again until its URL changes', () => {
    expect(fetchIds(0)).toEqual(['a', 'b'])
    expect(
      repository.recordLogo({ id: 'a', url: 'http://l/a.png', at: now, path: 'tv/a.png' }),
    ).toBe(true)
    expect(fetchIds(48)).toEqual(['b'])
    repository.applyRefresh(
      plan({
        channels: {
          update: [
            {
              id: 'a',
              name: 'Télé Matin',
              groupId: 'g1',
              position: 0,
              upstream: { url: 'http://p/a.ts' },
              number: undefined,
              guideKey: undefined,
              logoUrl: 'http://l/a2.png',
            },
          ],
        },
      }),
    )
    expect(fetchIds(0)).toEqual(['a', 'b'])
  })

  test('a failed attempt is retried after a day, even with a previous file kept', () => {
    repository.recordLogo({ id: 'a', url: 'http://l/a.png', at: now, path: 'tv/a.png' })
    repository.recordLogo({ id: 'a', url: 'http://l/a2.png', at: at(1) })
    repository.recordLogo({ id: 'b', url: 'http://l/b.png', at: at(1) })
    expect(stored('a')).toMatchObject({
      logoPath: 'tv/a.png',
      logoFetchedUrl: 'http://l/a2.png',
      logoFetchedAt: now,
      logoFailedAt: at(1),
    })
    // `a` still lists `a.png`: its URL differs from the failed attempt's, so it is fetched now.
    expect(fetchIds(2)).toEqual(['a'])
    repository.recordLogo({ id: 'a', url: 'http://l/a.png', at: at(1), path: 'tv/a.png' })
    repository.recordLogo({ id: 'a', url: 'http://l/a.png', at: at(2) })
    expect(fetchIds(25)).toEqual([])
    expect(fetchIds(26)).toEqual(['b'])
    expect(fetchIds(27)).toEqual(['a', 'b'])

    repository.recordLogo({ id: 'b', url: 'http://l/b.png', at: at(26), path: 'tv/b.webp' })
    expect(stored('b').logoFailedAt).toBeUndefined()
    expect(fetchIds(100)).toEqual(['a'])
  })

  test('recording for a deleted channel updates nothing', () => {
    repository.applyRefresh(plan({ channels: { delete: ['a'] } }))
    expect(
      repository.recordLogo({ id: 'a', url: 'http://l/a.png', at: now, path: 'tv/a.png' }),
    ).toBe(false)
  })

  test('a logo the source no longer gives is dropped, missing and disabled channels included', () => {
    repository.recordLogo({ id: 'a', url: 'http://l/a.png', at: now, path: 'tv/a.png' })
    repository.recordLogo({ id: 'c', url: 'http://l/c.png', at: now, path: 'tv/c.png' })
    repository.applyRefresh(
      plan({
        channels: {
          update: [
            {
              id: 'c',
              name: 'Canal_Plus',
              groupId: 'g1',
              position: 2,
              upstream: { url: 'http://p/c.ts' },
              number: undefined,
              guideKey: undefined,
              logoUrl: undefined,
            },
          ],
          missing: ['a'],
        },
      }),
    )
    const work = repository.logoWork({ sourceId: 's1', retryFailedBefore: now })
    expect(work.fetch.map((c) => c.id)).toEqual(['b'])
    expect(work.drop.map((c) => c.id)).toEqual(['c'])
    repository.dropLogo('c')
    expect(stored('c')).not.toHaveProperty('logoPath')
    expect(stored('c')).not.toHaveProperty('logoFetchedUrl')
    expect(repository.logoPathsOf('s1')).toEqual(['tv/a.png'])
  })
})

describe('refresh (§29.2)', () => {
  test('markMissing keeps the first missing date of a channel already missing', () => {
    repository.applyRefresh(plan({ channels: { missing: ['a'] } }))
    const later = plan({})
    repository.applyRefresh({
      ...later,
      channels: { ...later.channels, markMissing: { ids: ['a', 'b'], at: at(48) } },
    })
    expect(stored('a').missingSince).toEqual(now)
    expect(stored('b').missingSince).toEqual(at(48))
    expect(repository.countsBySource().get('s1')).toEqual({
      channelCount: 2,
      enabledChannelCount: 1,
    })
  })

  test('a channel moved out of a deleted group survives it; the group goes after its channels', () => {
    repository.applyRefresh(
      plan({
        groups: { insert: [group('g2', 'Sports', 1)], delete: ['g1'] },
        channels: {
          update: (['a', 'b'] as const).map((id, position) => ({
            id,
            name: stored(id).name,
            groupId: 'g2',
            position,
            upstream: stored(id).upstream,
            number: undefined,
            guideKey: undefined,
            logoUrl: stored(id).logoUrl,
          })),
          delete: ['c', 'd'],
        },
      }),
    )
    expect(repository.groupsOf('s1').map((g) => [g.id, g.channelCount])).toEqual([['g2', 2]])
    expect(
      repository
        .stateOf('s1')
        .channels.map((c) => c.id)
        .sort(),
    ).toEqual(['a', 'b'])
  })
})

describe('channel search (§29.7)', () => {
  const search = (text: string) =>
    repository
      .listChannels({ sourceId: 's1', search: searchNameOf(text), offset: 0, limit: 50 })
      .items.map((c) => c.name)

  test('ignores case and accents', () => {
    expect(search('TELE')).toEqual(['Télé Matin'])
    expect(search('télé m')).toEqual(['Télé Matin'])
  })

  test('% and _ match themselves, not any text', () => {
    expect(search('100%')).toEqual(['100% Musique'])
    expect(search('%')).toEqual(['100% Musique'])
    expect(search('canal_')).toEqual(['Canal_Plus'])
    expect(search('_')).toEqual(['Canal_Plus'])
    expect(search('\\')).toEqual([])
    expect(search('canal')).toEqual(['Canal_Plus', 'Canal Plus'])
  })

  test('hides missing channels and counts the matches', () => {
    repository.applyRefresh(plan({ channels: { missing: ['c'] } }))
    expect(search('canal')).toEqual(['Canal Plus'])
    expect(
      repository.listChannels({ sourceId: 's1', search: 'a', offset: 1, limit: 1 }),
    ).toMatchObject({ total: 2, items: [{ name: 'Canal Plus' }] })
  })
})

describe('viewer channels and probes (§29.4, §29.7)', () => {
  test('lists enabled present channels in group then playlist order, with their groups', () => {
    repository.applyRefresh(
      plan({
        groups: { insert: [group('g0', 'Kids', -1)] },
        channels: {
          insert: [channel('k', 'Kids One', { groupId: 'g0', position: 9 })],
          missing: ['d'],
        },
      }),
    )
    const listed = repository.listViewable()
    expect(listed.groups.map((g) => g.name)).toEqual(['Kids', 'News'])
    expect(listed.channels.map((c) => c.id)).toEqual(['k', 'a', 'b'])
  })

  test('caches a probe and drops it', () => {
    expect(repository.probeOf('a')).toBeUndefined()
    const probe = {
      video: { codec: 'h264', height: 1080, fieldOrder: 'tt' },
      audio: [{ index: 1, codec: 'mp2', channels: 2, audioDescription: false }],
      transport: 'udp' as const,
    }
    repository.recordProbe({ id: 'a', probe, at: now })
    expect(repository.probeOf('a')).toEqual(probe)
    repository.recordProbe({ id: 'a', at: now })
    expect(repository.probeOf('a')).toBeUndefined()
  })
})
