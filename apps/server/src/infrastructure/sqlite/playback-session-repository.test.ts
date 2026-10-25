import { beforeEach, describe, expect, test } from 'bun:test'

import {
  insertItem,
  insertLibrary,
  insertSource,
  seedViewer,
} from '../../../test/support/catalog-fixtures.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import type { NewPlaybackSession, PlaybackSessionRepository } from '../../core/playback/session.ts'
import { createSqlitePlaybackSessionRepository } from './playback-session-repository.ts'

let repo: PlaybackSessionRepository
let viewer: ReturnType<typeof seedViewer>
let other: ReturnType<typeof seedViewer>
const t0 = new Date('2026-02-01T10:00:00.000Z')

const session = (id: string, extra: Partial<NewPlaybackSession> = {}): NewPlaybackSession => ({
  id,
  profileId: viewer.profileId,
  authSessionId: viewer.authSessionId,
  sourceId: 'source-1',
  itemId: 'movie-1',
  mode: 'hls_remux',
  quality: 'original',
  audioStream: 1,
  audioDelivery: 'aac',
  burnIn: false,
  startedAt: t0,
  lastHeartbeatAt: t0,
  positionMs: 0,
  ...extra,
})

beforeEach(() => {
  const db = createTestDatabase()
  viewer = seedViewer(db)
  other = seedViewer(db, 'account-2')
  insertLibrary(db)
  insertItem(db, { id: 'movie-1', kind: 'movie' })
  insertSource(db, { id: 'source-1', itemId: 'movie-1' })
  repo = createSqlitePlaybackSessionRepository({ db })
})

describe('playback session repository', () => {
  test('insert and find, with the account of the auth session', () => {
    repo.insert(session('p1'))
    expect(repo.findById('p1')).toEqual({ ...session('p1'), accountId: viewer.accountId })
    expect(repo.findById('nope')).toBeUndefined()
  })

  test('heartbeat, stale listing and end', () => {
    repo.insert(session('p1'))
    const { audioDelivery: _none, ...direct } = session('p2', { mode: 'direct' })
    repo.insert(direct)
    const later = new Date(t0.getTime() + 30_000)
    repo.heartbeat({ id: 'p2', at: later, positionMs: 42_000 })
    expect(repo.findById('p2')).toMatchObject({ lastHeartbeatAt: later, positionMs: 42_000 })
    expect(repo.listStale({ notAfter: t0 }).map((s) => s.id)).toEqual(['p1'])
    expect(
      repo
        .listActive()
        .map((s) => s.id)
        .sort(),
    ).toEqual(['p1', 'p2'])

    repo.end({ id: 'p1', at: later })
    repo.end({ id: 'p1', at: new Date(later.getTime() + 1000) })
    expect(repo.findById('p1')?.endedAt).toEqual(later)
    expect(repo.listStale({ notAfter: later }).map((s) => s.id)).toEqual(['p2'])
    expect(repo.listActive().map((s) => s.id)).toEqual(['p2'])
  })

  test('active sessions of profiles or of an account (deletion, deactivation, §14)', () => {
    repo.insert(session('mine'))
    repo.insert(
      session('theirs', { profileId: other.profileId, authSessionId: other.authSessionId }),
    )
    repo.insert(session('ended'))
    repo.end({ id: 'ended', at: t0 })
    const ids = (scope: Parameters<PlaybackSessionRepository['listActiveWithin']>[0]) =>
      repo.listActiveWithin(scope).map((s) => s.id)
    expect(ids({ profileIds: [viewer.profileId] })).toEqual(['mine'])
    expect(ids({ profileIds: [] })).toEqual([])
    expect(ids({ accountId: 'account-2' })).toEqual(['theirs'])
    expect(ids({ accountId: 'nobody' })).toEqual([])
  })
})
