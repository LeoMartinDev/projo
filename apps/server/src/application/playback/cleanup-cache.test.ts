import { describe, expect, test } from 'bun:test'

import { createCapturingLogger, silentLogger } from '../../../test/support/logger.ts'
import type { TranscodeCacheEntry, TranscodeCacheInventory } from '../../core/playback/ports.ts'
import type { PlaybackSession } from '../../core/playback/session.ts'
import { defaultPlaybackSettings } from '../../core/settings/settings.ts'
import { cleanupCacheFactory } from './cleanup-cache.ts'

const gib = 1024 ** 3

const sessionWith = (id: string, endedAt?: Date): PlaybackSession => ({
  id,
  profileId: 'profile-1',
  authSessionId: 'auth-1',
  accountId: 'account-1',
  sourceId: 'source-1',
  itemId: 'item-1',
  mode: 'hls_transcode',
  burnIn: false,
  startedAt: new Date(0),
  lastHeartbeatAt: new Date(0),
  positionMs: 0,
  ...(endedAt === undefined ? {} : { endedAt }),
})

const world = (
  folders: TranscodeCacheEntry[],
  sessions: PlaybackSession[],
  transcodeCacheMaxGb = 10,
  logger = silentLogger,
) => {
  const present = new Map(folders.map((folder) => [folder.sessionId, folder]))
  const transcodeCache: TranscodeCacheInventory = {
    entries: () => [...present.values()],
    remove: (sessionId) => {
      present.delete(sessionId)
    },
  }
  const cleanup = cleanupCacheFactory({
    sessionRepository: { findById: (id) => sessions.find((session) => session.id === id) },
    transcodeCache,
    playbackSettings: { read: () => ({ ...defaultPlaybackSettings, transcodeCacheMaxGb }) },
    logger,
  })
  return { cleanup, remaining: () => [...present.keys()].sort() }
}

describe('cleanup_cache (§10.3)', () => {
  test('under the cap: nothing deleted, not even ended sessions', () => {
    const { cleanup, remaining } = world(
      [
        { sessionId: 'a', sizeBytes: 3 * gib },
        { sessionId: 'b', sizeBytes: 3 * gib },
      ],
      [sessionWith('a', new Date(1000)), sessionWith('b')],
    )
    expect(cleanup()).toEqual({ removed: [], freedBytes: 0, totalBytes: 6 * gib })
    expect(remaining()).toEqual(['a', 'b'])
  })

  test('over the cap: oldest ended first (orphans before), until under it', () => {
    const { cleanup, remaining } = world(
      [
        { sessionId: 'active', sizeBytes: 4 * gib },
        { sessionId: 'ended-recent', sizeBytes: 3 * gib },
        { sessionId: 'ended-old', sizeBytes: 3 * gib },
        { sessionId: 'orphan', sizeBytes: 1 * gib },
        { sessionId: 'ended-middle', sizeBytes: 2 * gib },
      ],
      [
        sessionWith('active'),
        sessionWith('ended-recent', new Date(3000)),
        sessionWith('ended-old', new Date(1000)),
        sessionWith('ended-middle', new Date(2000)),
      ],
    )
    // 13 GiB for 10: orphan (1), ended-old (3) → 9 GiB.
    expect(cleanup()).toEqual({
      removed: ['orphan', 'ended-old'],
      freedBytes: 4 * gib,
      totalBytes: 9 * gib,
    })
    expect(remaining()).toEqual(['active', 'ended-middle', 'ended-recent'])
  })

  test('active sessions are never deleted, even when the cache stays over the cap', () => {
    const { logger, lines } = createCapturingLogger()
    const { cleanup, remaining } = world(
      [
        { sessionId: 'active-1', sizeBytes: 2 * gib },
        { sessionId: 'active-2', sizeBytes: 2 * gib },
        { sessionId: 'ended', sizeBytes: 1 * gib },
      ],
      [sessionWith('active-1'), sessionWith('active-2'), sessionWith('ended', new Date(5))],
      3,
      logger,
    )
    expect(cleanup()).toMatchObject({ removed: ['ended'], totalBytes: 4 * gib })
    expect(remaining()).toEqual(['active-1', 'active-2'])
    expect(lines.map((line) => line.message)).toContain(
      'transcode cache over its cap with active sessions only',
    )
  })

  test('the cap is read on every run (settings change without restart)', () => {
    let max = 10
    const present = new Map([['ended', { sessionId: 'ended', sizeBytes: 5 * gib }]])
    const cleanup = cleanupCacheFactory({
      sessionRepository: { findById: (id) => sessionWith(id, new Date(1)) },
      transcodeCache: {
        entries: () => [...present.values()],
        remove: (id) => {
          present.delete(id)
        },
      },
      playbackSettings: { read: () => ({ ...defaultPlaybackSettings, transcodeCacheMaxGb: max }) },
      logger: silentLogger,
    })
    expect(cleanup().removed).toEqual([])
    max = 4
    expect(cleanup().removed).toEqual(['ended'])
  })
})
