import { beforeEach, describe, expect, test } from 'bun:test'

import { insertAccount, insertProfile } from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { TvChannel } from '../../core/tv/channel.ts'
import type { TvSnapshotRepository } from '../../core/tv/snapshot.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import { createSqliteTvChannelRepository } from './tv-channel-repository.ts'
import { createSqliteTvFavoriteRepository } from './tv-favorite-repository.ts'
import { createSqliteTvSnapshotRepository } from './tv-snapshot-repository.ts'
import { createSqliteTvSourceRepository } from './tv-source-repository.ts'

const now = new Date('2026-11-18T20:00:00.000Z')
const minutes = (count: number) => new Date(now.getTime() + count * 60_000)

const channel = (id: string, position: number, extra: Partial<TvChannel> = {}): TvChannel => ({
  id,
  sourceId: 's1',
  key: id,
  name: id,
  groupId: 'g1',
  position,
  upstream: { url: `http://p/${id}.ts` },
  enabled: true,
  createdAt: now,
  ...extra,
})

let snapshots: TvSnapshotRepository
let sources: TvSourceRepository
let favoriteOf: (channelId: string) => void

beforeEach(() => {
  const db = createTestDatabase()
  sources = createSqliteTvSourceRepository({ db })
  sources.save({
    id: 's1',
    name: 'Box',
    settings: { kind: 'm3u', playlistUrl: 'http://p/list.m3u' },
    createdAt: now,
    failureCount: 0,
  })
  const channels = createSqliteTvChannelRepository({ db })
  channels.applyRefresh({
    sourceId: 's1',
    groups: {
      insert: [
        { id: 'g1', sourceId: 's1', name: 'B', enabled: true, position: 1 },
        { id: 'g0', sourceId: 's1', name: 'A', enabled: true, position: 0 },
      ],
      update: [],
      delete: [],
    },
    channels: {
      insert: [
        channel('a', 0),
        channel('b', 1),
        channel('off', 2, { enabled: false }),
        channel('first', 0, { groupId: 'g0' }),
      ],
      update: [],
      markMissing: { ids: [], at: now },
      delete: [],
    },
  })
  snapshots = createSqliteTvSnapshotRepository({ db })
  const profileId = insertProfile(db, insertAccount(db))
  const favorites = createSqliteTvFavoriteRepository({ db })
  favoriteOf = (channelId) => favorites.add({ profileId, channelId, at: now })
})

describe('the snapshots of channels and sources (§29.4)', () => {
  test("a source's setting: its default (off at one connection), else the admin's", () => {
    expect(snapshots.sources()).toEqual([{ id: 's1', snapshots: true, grabsPerHour: 60 }])
    const stored = sources.findById('s1')
    if (stored === undefined) throw new Error('no source')
    sources.save({ ...stored, maxConnections: 1 })
    expect(snapshots.sources()[0]).toMatchObject({ maxConnections: 1, snapshots: false })
    sources.save({ ...stored, maxConnections: 1, snapshots: true, snapshotGrabsPerHour: 12 })
    expect(snapshots.sources()[0]).toMatchObject({ snapshots: true, grabsPerHour: 12 })
    expect(sources.findById('s1')).toMatchObject({ snapshots: true, snapshotGrabsPerHour: 12 })
  })

  test("the source's enabled channels in the page's order, with their state", () => {
    expect(snapshots.candidatesOf('s1').map((c) => c.id)).toEqual(['first', 'a', 'b'])
    expect(snapshots.recordSnapshot({ id: 'a', at: now, grabbed: true })).toBe(true)
    snapshots.recordGrabFailure({ id: 'b', at: minutes(1) })
    snapshots.recordGrabFailure({ id: 'b', at: minutes(2) })
    snapshots.recordWatched({ id: 'first', at: minutes(3) })
    expect(snapshots.candidatesOf('s1')).toEqual([
      { id: 'first', failures: 0, watchedAt: minutes(3) },
      { id: 'a', snapshotAt: now, attemptAt: now, failures: 0 },
      { id: 'b', attemptAt: minutes(2), failures: 2 },
    ])
    // A grab's success resets the failures; a free snapshot leaves the attempts alone.
    snapshots.recordSnapshot({ id: 'b', at: minutes(4), grabbed: false })
    expect(snapshots.candidatesOf('s1')[2]).toEqual({
      id: 'b',
      snapshotAt: minutes(4),
      attemptAt: minutes(2),
      failures: 2,
    })
    snapshots.recordSnapshot({ id: 'b', at: minutes(5), grabbed: true })
    expect(snapshots.candidatesOf('s1')[2]).toMatchObject({ failures: 0 })
    expect(snapshots.recordSnapshot({ id: 'gone', at: now, grabbed: false })).toBe(false)
  })

  test('fresh snapshots of enabled channels, favourites, and the paths to delete', () => {
    snapshots.recordSnapshot({ id: 'a', at: minutes(-90), grabbed: false })
    snapshots.recordSnapshot({ id: 'b', at: minutes(-10), grabbed: false })
    snapshots.recordSnapshot({ id: 'off', at: minutes(-1), grabbed: false })
    expect(snapshots.freshSnapshots(minutes(-60))).toEqual(new Map([['b', minutes(-10)]]))
    expect(snapshots.snapshotAtOf('a')).toEqual(minutes(-90))
    expect(snapshots.snapshotAtOf('first')).toBeUndefined()
    expect(snapshots.snapshotPathsOf('s1').sort()).toEqual([
      'tv/snapshots/a.webp',
      'tv/snapshots/b.webp',
      'tv/snapshots/off.webp',
    ])
    favoriteOf('b')
    expect(snapshots.favoriteChannelIds()).toEqual(new Set(['b']))
  })
})
