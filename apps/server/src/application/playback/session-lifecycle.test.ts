import { beforeEach, describe, expect, test } from 'bun:test'

import { createManualClock, type ManualClock } from '../../../test/support/clock.ts'
import { createRecordingEventBus } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import type { ServerEvent } from '../../core/events.ts'
import type { HlsSegmenter, TranscodeCache } from '../../core/playback/ports.ts'
import type { PlaybackSession, PlaybackSessionRepository } from '../../core/playback/session.ts'
import type { ItemProgress, ProgressRepository } from '../../core/progress/progress.ts'
import {
  authorizePlaybackFactory,
  authorizeStreamFactory,
  endPlaybackSessionFactory,
  endPlaybackSessionsWithinFactory,
  heartbeatFactory,
  stopPlaybackSessionFactory,
  sweepPlaybackSessionsFactory,
} from './session-lifecycle.ts'

const inMemorySessions = (): PlaybackSessionRepository & { rows: Map<string, PlaybackSession> } => {
  const rows = new Map<string, PlaybackSession>()
  return {
    rows,
    insert: (session) => rows.set(session.id, { ...session, accountId: 'account-1' }) && undefined,
    findById: (id) => rows.get(id),
    heartbeat: ({ id, at, positionMs }) => {
      const row = rows.get(id)
      if (row) rows.set(id, { ...row, lastHeartbeatAt: at, positionMs })
    },
    end: ({ id, at }) => {
      const row = rows.get(id)
      if (row && row.endedAt === undefined) rows.set(id, { ...row, endedAt: at })
    },
    listStale: ({ notAfter }) =>
      [...rows.values()].filter((s) => s.endedAt === undefined && s.lastHeartbeatAt <= notAfter),
    listActive: () => [...rows.values()].filter((s) => s.endedAt === undefined),
    listActiveWithin: (scope) =>
      [...rows.values()].filter(
        (s) => s.endedAt === undefined && 'itemIds' in scope && scope.itemIds.includes(s.itemId),
      ),
  }
}

const inMemoryProgress = (): ProgressRepository & { rows: Map<string, ItemProgress> } => {
  const rows = new Map<string, ItemProgress>()
  return {
    rows,
    find: ({ itemId }) => rows.get(itemId),
    findMany: ({ itemIds }) =>
      new Map(itemIds.flatMap((id) => (rows.has(id) ? [[id, rows.get(id) as ItemProgress]] : []))),
    save: (progress) => void rows.set(progress.itemId, progress),
    saveMany: (list) => list.forEach((progress) => rows.set(progress.itemId, progress)),
    showAncestorsAgain: () => {},
  }
}

const source: PlayableSource = {
  id: 'source-1',
  state: 'ready',
  libraryId: 'library-1',
  path: '/media/film.mkv',
  rootReachable: true,
  extension: 'mkv',
  sizeBytes: 1,
  mtime: 1,
  version: {},
  media: { durationMs: 3_600_000, video: [], audio: [], subtitles: [] },
}
const part = (id: string, partIndex: number, durationMs: number): PlayableSource => ({
  ...source,
  id,
  stackGroupId: 'stack',
  partIndex,
  media: { durationMs, video: [], audio: [], subtitles: [] },
})
/** A movie in two parts (§7.7) and a two-episode file (§8.4). */
const parts = [part('cd1', 1, 1_000_000), part('cd2', 2, 2_000_000)]
const double: PlayableSource = { ...source, id: 'e01-e02' }
/** A longer cut of `movie-2` (§7.7): 90 min against 60. */
const extended: PlayableSource = {
  ...source,
  id: 'extended',
  media: { durationMs: 5_400_000, video: [], audio: [], subtitles: [] },
}
const sourcesById = new Map([source, ...parts, double, extended].map((entry) => [entry.id, entry]))
const catalog = {
  findSource: (id: string) => sourcesById.get(id),
  listReadySources: ({ itemId }: { itemId: string }) => (itemId === 'movie-2' ? [source] : parts),
  listSourceItemIds: (id: string) => (id === double.id ? ['e1', 'e2'] : []),
  // §12.4: `movie-2` has end credits from 50 min.
  listMediaSegments: (itemId: string) =>
    itemId === 'movie-2' ? [{ type: 'credits', startMs: 3_000_000, endMs: 3_600_000 }] : [],
} as unknown as CatalogRepository

let clock: ManualClock
let sessions: ReturnType<typeof inMemorySessions>
let progress: ReturnType<typeof inMemoryProgress>
let events: ServerEvent[]
let stopped: string[]
let cacheDirs: Set<string>
/** Sessions the segmenter / HLS stream still hold state for. */
let streaming: Set<string>
let released: string[]
let lifecycle: ReturnType<typeof build>

const build = () => {
  const { bus, events: recorded } = createRecordingEventBus()
  events = recorded
  const segmenter: HlsSegmenter = {
    segment: async () => {
      throw new Error('unused')
    },
    stop: (id) => void stopped.push(id),
    stopAll: async () => {},
    sessionIds: () => [],
  }
  const transcodeCache: TranscodeCache = {
    listSessionIds: () => [...cacheDirs],
    remove: (id) => void cacheDirs.delete(id),
  }
  const endSession = endPlaybackSessionFactory({
    sessionRepository: sessions,
    segmenter,
    eventBus: bus,
    clock,
    logger: silentLogger,
  })
  // The child's profile sees nothing; the others see everything.
  const isItemVisible = ({ profileId }: { profileId: string }) => profileId !== 'profile-kid'
  const authorize = authorizePlaybackFactory({
    sessionRepository: sessions,
    endSession,
    isItemVisible,
    clock,
  })
  return {
    authorizeStream: authorizeStreamFactory({
      sessionRepository: sessions,
      endSession,
      hashSecret: (secret) => `h(${secret})`,
      clock,
    }),
    heartbeat: heartbeatFactory({
      authorize,
      sessionRepository: sessions,
      catalogRepository: catalog,
      progressRepository: progress,
      clock,
    }),
    stop: stopPlaybackSessionFactory({ sessionRepository: sessions, endSession, isItemVisible }),
    endWithin: endPlaybackSessionsWithinFactory({ sessionRepository: sessions, endSession }),
    sweep: sweepPlaybackSessionsFactory({
      sessionRepository: sessions,
      transcodeCache,
      endSession,
      streams: {
        sessionIds: () => [...streaming],
        release: (id) => {
          released.push(id)
          streaming.delete(id)
        },
      },
      clock,
      logger: silentLogger,
    }),
  }
}

const open = (id: string, { sourceId = source.id, itemId = 'movie-1' } = {}) =>
  sessions.insert({
    id,
    profileId: 'profile-1',
    authSessionId: 'auth-1',
    sourceId,
    itemId,
    mode: 'hls_remux',
    burnIn: false,
    streamSecretHash: `h(secret-${id})`,
    startedAt: clock.now(),
    lastHeartbeatAt: clock.now(),
    positionMs: 0,
  })

beforeEach(() => {
  clock = createManualClock()
  sessions = inMemorySessions()
  progress = inMemoryProgress()
  stopped = []
  cacheDirs = new Set()
  streaming = new Set()
  released = []
  lifecycle = build()
})

describe('heartbeat', () => {
  test('keeps the session alive and writes the profile progress', async () => {
    open('s1')
    clock.advance(10_000)
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 1_800_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { progress: { positionMs: 1_800_000, durationMs: 3_600_000 } },
    })
    expect(sessions.rows.get('s1')).toMatchObject({
      lastHeartbeatAt: clock.now(),
      positionMs: 1_800_000,
    })
    expect(progress.rows.get('movie-1')).toMatchObject({
      profileId: 'profile-1',
      lastPlayedAt: clock.now(),
    })
  })

  test('§12.4 entering the credits marks the item watched before 93 %', async () => {
    open('s1', { itemId: 'movie-2' })
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 3_010_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { progress: { watched: true, playCount: 1, positionMs: 3_600_000 } },
    })
    // The session keeps the real position (the player's), the progress says "vu".
    expect(sessions.rows.get('s1')?.positionMs).toBe(3_010_000)
  })

  test('§12.4 credits timed on another cut do not mark a longer version watched', async () => {
    open('s1', { itemId: 'movie-2', sourceId: 'extended' })
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 3_010_000,
    })
    expect(result).toMatchObject({
      ok: true,
      value: { progress: { watched: false, positionMs: 3_010_000 } },
    })
  })

  test('a part of a stack: the position is cumulative, measured against all the parts', async () => {
    open('s1', { sourceId: 'cd2' })
    expect(
      await lifecycle.heartbeat({
        sessionId: 's1',
        accountId: 'account-1',
        profileId: 'profile-1',
        positionMs: 2_900_000,
      }),
    ).toMatchObject({
      ok: true,
      value: { progress: { positionMs: 2_900_000, durationMs: 3_000_000, watched: true } },
    })
  })

  test('a multi-episode file: same position and "vu" on every episode', async () => {
    open('s1', { sourceId: double.id, itemId: 'e1' })
    const result = await lifecycle.heartbeat({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
      positionMs: 3_500_000,
    })
    expect(result).toMatchObject({ ok: true, value: { progress: { itemId: 'e1', watched: true } } })
    expect(
      [...progress.rows.values()].map((row) => [row.itemId, row.positionMs, row.watched]),
    ).toEqual([
      ['e1', 3_500_000, true],
      ['e2', 3_500_000, true],
    ])
  })

  test('another account cannot use the session', async () => {
    open('s1')
    expect(
      await lifecycle.heartbeat({
        sessionId: 's1',
        accountId: 'intruder',
        profileId: 'profile-1',
        positionMs: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'playback/session_not_found' },
    })
  })

  test('another profile of the account: only if it sees the item; none resolved: refused', async () => {
    open('s1')
    const beat = (profileId: string | undefined) =>
      lifecycle.heartbeat({ sessionId: 's1', accountId: 'account-1', profileId, positionMs: 1 })
    for (const profileId of ['profile-kid', undefined]) {
      expect(await beat(profileId)).toMatchObject({
        ok: false,
        error: { code: 'playback/session_not_found' },
      })
    }
    expect((await beat('profile-2')).ok).toBe(true)
  })

  test('60 s of silence: the late heartbeat finds the session over', async () => {
    open('s1')
    clock.advance(60_000)
    expect(
      await lifecycle.heartbeat({
        sessionId: 's1',
        accountId: 'account-1',
        profileId: 'profile-1',
        positionMs: 1,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'playback/session_expired' },
    })
    expect(stopped).toEqual(['s1'])
    expect(events).toEqual([
      {
        type: 'playback.session_terminated',
        payload: { playbackSessionId: 's1', sessionId: 'auth-1', reason: 'timeout' },
      },
    ])
  })
})

describe('sweep', () => {
  test('ends sessions without heartbeat for 60 s, not the others', () => {
    open('quiet')
    clock.advance(30_000)
    open('lively')
    clock.advance(29_999)
    expect(lifecycle.sweep().expired).toBe(0)
    clock.advance(1)
    expect(lifecycle.sweep().expired).toBe(1)
    expect(sessions.rows.get('quiet')?.endedAt).toEqual(clock.now())
    expect(sessions.rows.get('lively')?.endedAt).toBeUndefined()
    expect(stopped).toEqual(['quiet'])
    expect(events.map((event) => event.payload)).toEqual([
      { playbackSessionId: 'quiet', sessionId: 'auth-1', reason: 'timeout' },
    ])
  })

  test('cache folders: kept while active and for 5 min after the end, orphans removed', async () => {
    open('active')
    open('ended')
    cacheDirs = new Set(['active', 'ended', 'orphan'])
    await lifecycle.stop({ sessionId: 'ended', accountId: 'account-1', profileId: 'profile-1' })
    expect(lifecycle.sweep().purged).toBe(1)
    expect([...cacheDirs]).toEqual(['active', 'ended'])

    clock.advance(5 * 60_000 - 1)
    // Keep "active" alive meanwhile.
    sessions.heartbeat({ id: 'active', at: clock.now(), positionMs: 0 })
    lifecycle.sweep()
    expect([...cacheDirs]).toEqual(['active', 'ended'])
    clock.advance(1)
    lifecycle.sweep()
    expect([...cacheDirs]).toEqual(['active'])
  })
})

describe('sweep: safety net for sessions gone without `endSession` (SQL cascade)', () => {
  test('releases the streams of a session missing or ended, keeps its folder one more pass', () => {
    open('live')
    open('ended')
    sessions.end({ id: 'ended', at: clock.now() })
    streaming = new Set(['live', 'ended', 'ghost'])
    cacheDirs = new Set(['live', 'ghost'])
    lifecycle.sweep()
    expect(released.sort()).toEqual(['ended', 'ghost'])
    // ffmpeg may still be dying: the folder goes on the next pass.
    expect([...cacheDirs].sort()).toEqual(['ghost', 'live'])
    lifecycle.sweep()
    expect([...cacheDirs]).toEqual(['live'])
    expect(released.sort()).toEqual(['ended', 'ghost'])
  })
})

describe('endWithin', () => {
  test('ends the active sessions of the scope as stopped by the administrator', () => {
    open('s1')
    sessions.insert({ ...sessions.rows.get('s1')!, id: 's2', itemId: 'movie-2' })
    lifecycle.endWithin({ itemIds: ['movie-1'] })
    expect(stopped).toEqual(['s1'])
    expect(events.map((event) => event.payload)).toEqual([
      { playbackSessionId: 's1', sessionId: 'auth-1', reason: 'admin' },
    ])
  })
})

describe('stop', () => {
  test('ends once, publishes `ended`, is idempotent', async () => {
    open('s1')
    const first = await lifecycle.stop({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
    })
    clock.advance(1000)
    const second = await lifecycle.stop({
      sessionId: 's1',
      accountId: 'account-1',
      profileId: 'profile-1',
    })
    expect(first).toMatchObject({
      ok: true,
      value: { endedAt: new Date('2026-01-01T00:00:00.000Z') },
    })
    expect(second).toMatchObject({
      ok: true,
      value: { endedAt: new Date('2026-01-01T00:00:00.000Z') },
    })
    expect(events.map((event) => event.payload)).toEqual([
      { playbackSessionId: 's1', sessionId: 'auth-1', reason: 'ended' },
    ])
    expect(
      await lifecycle.stop({ sessionId: 'nope', accountId: 'account-1', profileId: 'profile-1' }),
    ).toMatchObject({
      ok: false,
    })
  })

  test('same rule as the other routes: another account, or a profile that does not see the item', async () => {
    open('s1')
    for (const user of [
      { accountId: 'account-2', profileId: 'profile-1' },
      { accountId: 'account-1', profileId: 'profile-kid' },
      { accountId: 'account-1', profileId: undefined },
    ]) {
      expect(await lifecycle.stop({ sessionId: 's1', ...user })).toMatchObject({
        ok: false,
        error: { code: 'playback/session_not_found' },
      })
    }
    expect(sessions.rows.get('s1')?.endedAt).toBeUndefined()
    expect(stopped).toEqual([])
    // Another profile of the account that sees the title may stop it (the TV left playing).
    expect(
      await lifecycle.stop({ sessionId: 's1', accountId: 'account-1', profileId: 'profile-2' }),
    ).toMatchObject({ ok: true })
    expect(
      await lifecycle.stop({ sessionId: 's1', accountId: 'account-1', profileId: 'profile-1' }),
    ).toMatchObject({ ok: true })
  })
})

describe('authorizeStream (§20)', () => {
  test('the secret alone opens the session; a wrong or missing one names none', () => {
    open('s1')
    expect(lifecycle.authorizeStream({ sessionId: 's1', secret: 'secret-s1' })).toMatchObject({
      ok: true,
      value: { id: 's1' },
    })
    for (const access of [
      { sessionId: 's1', secret: 'secret-s2' },
      { sessionId: 's2', secret: 'secret-s2' },
    ]) {
      expect(lifecycle.authorizeStream(access)).toMatchObject({
        ok: false,
        error: { code: 'playback/session_not_found' },
      })
    }
  })

  test('a session made before the secrets has no stream URL left', () => {
    open('s1')
    const row = sessions.rows.get('s1')
    if (row === undefined) throw new Error('the session was opened')
    const { streamSecretHash: _hash, ...legacy } = row
    sessions.rows.set('s1', legacy)
    expect(lifecycle.authorizeStream({ sessionId: 's1', secret: 'secret-s1' })).toMatchObject({
      ok: false,
      error: { code: 'playback/session_not_found' },
    })
  })

  test('60 s without heartbeat: ended on the spot, the URL stops working', () => {
    open('s1')
    clock.advance(60_000)
    expect(lifecycle.authorizeStream({ sessionId: 's1', secret: 'secret-s1' })).toMatchObject({
      ok: false,
      error: { code: 'playback/session_expired' },
    })
    expect(stopped).toEqual(['s1'])
  })
})
