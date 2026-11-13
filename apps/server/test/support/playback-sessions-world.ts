import { authorizePlaybackFactory } from '../../src/application/playback/authorize-playback.ts'
import { authorizeStreamFactory } from '../../src/application/playback/authorize-stream.ts'
import { endPlaybackSessionFactory } from '../../src/application/playback/end-playback-session.ts'
import { endPlaybackSessionsWithinFactory } from '../../src/application/playback/end-playback-sessions-within.ts'
import { recordHeartbeatFactory } from '../../src/application/playback/record-heartbeat.ts'
import { stopPlaybackSessionFactory } from '../../src/application/playback/stop-playback-session.ts'
import { sweepPlaybackSessionsFactory } from '../../src/application/playback/sweep-playback-sessions.ts'
import type { PlayableSource, PlayableSources } from '../../src/core/catalog/catalog.ts'
import type { HlsSegmenter, TranscodeCache } from '../../src/core/playback/ports.ts'
import type { PlaybackSession, PlaybackSessionRepository } from '../../src/core/playback/session.ts'
import type { ItemProgress, ProgressRepository } from '../../src/core/progress/progress.ts'
import { createManualClock } from './clock.ts'
import { createRecordingEventBus } from './fakes.ts'
import { silentLogger } from './logger.ts'

/** The playback session use cases on in-memory sessions and progress (§10.6, §11). */

export const inMemorySessions = (): PlaybackSessionRepository & {
  rows: Map<string, PlaybackSession>
} => {
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

export const sessionSource: PlayableSource = {
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
  ...sessionSource,
  id,
  stackGroupId: 'stack',
  partIndex,
  media: { durationMs, video: [], audio: [], subtitles: [] },
})
const parts = [part('cd1', 1, 1_000_000), part('cd2', 2, 2_000_000)]
/** One file holding two episodes, `e1` and `e2`. */
export const doubleEpisodeSource: PlayableSource = { ...sessionSource, id: 'e01-e02' }
const extended: PlayableSource = {
  ...sessionSource,
  id: 'extended',
  media: { durationMs: 5_400_000, video: [], audio: [], subtitles: [] },
}
const sourcesById = new Map(
  [sessionSource, ...parts, doubleEpisodeSource, extended].map((entry) => [entry.id, entry]),
)
const catalog = {
  findSource: (id) => sourcesById.get(id),
  listReadySources: ({ itemId }) => (itemId === 'movie-2' ? [sessionSource] : parts),
  listSourceItemIds: (id) => (id === doubleEpisodeSource.id ? ['e1', 'e2'] : []),
  listMediaSegments: (itemId) =>
    itemId === 'movie-2' ? [{ type: 'credits', startMs: 3_000_000, endMs: 3_600_000 }] : [],
} satisfies PlayableSources

/**
 * A fresh world per test. `cacheDirs` (transcode cache folders) and `streaming` (live HLS
 * streams) start empty and are filled by the test; `stopped` and `released` record the
 * segmenter stops and the stream releases.
 */
export const createPlaybackSessionWorld = () => {
  const clock = createManualClock()
  const sessions = inMemorySessions()
  const progress = inMemoryProgress()
  const stopped: string[] = []
  const cacheDirs = new Set<string>()
  const streaming = new Set<string>()
  const released: string[] = []
  const { bus, events } = createRecordingEventBus()
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
    afterCommit: (effect) => effect(),
    clock,
    logger: silentLogger,
  })
  const isItemVisible = ({ profileId }: { profileId: string }) => profileId !== 'profile-kid'
  const authorize = authorizePlaybackFactory({
    sessionRepository: sessions,
    endSession,
    isItemVisible,
    clock,
  })
  const lifecycle = {
    authorizeStream: authorizeStreamFactory({
      sessionRepository: sessions,
      endSession,
      hashSecret: (secret) => `h(${secret})`,
      clock,
    }),
    heartbeat: recordHeartbeatFactory({
      authorize,
      sessionRepository: sessions,
      playableSources: catalog,
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

  const open = (id: string, { sourceId = sessionSource.id, itemId = 'movie-1' } = {}) =>
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

  return {
    clock,
    sessions,
    progress,
    events,
    stopped,
    cacheDirs,
    streaming,
    released,
    lifecycle,
    open,
  }
}

export type PlaybackSessionWorld = ReturnType<typeof createPlaybackSessionWorld>
