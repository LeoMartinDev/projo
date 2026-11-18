import { appError, err, ok, type Result } from '@projo/shared'

import { authorizeLiveStreamFactory } from '../../src/application/tv/authorize-live-stream.ts'
import { createLiveSessionFactory } from '../../src/application/tv/create-live-session.ts'
import { endLiveSessionFactory } from '../../src/application/tv/end-live-session.ts'
import { getLiveFileFactory } from '../../src/application/tv/get-live-file.ts'
import { getLivePlaylistFactory } from '../../src/application/tv/get-live-playlist.ts'
import { listLiveSessionsFactory } from '../../src/application/tv/list-live-sessions.ts'
import { liveStreamsFactory } from '../../src/application/tv/live-streams.ts'
import { recordLiveHeartbeatFactory } from '../../src/application/tv/record-live-heartbeat.ts'
import { stopLiveSessionAsAdminFactory } from '../../src/application/tv/stop-live-session-as-admin.ts'
import { stopLiveSessionFactory } from '../../src/application/tv/stop-live-session.ts'
import { sweepLiveSessionsFactory } from '../../src/application/tv/sweep-live-sessions.ts'
import type { TvChannel } from '../../src/core/tv/channel.ts'
import type {
  LiveProbeError,
  LiveProber,
  LiveRelay,
  LiveRunExit,
  LiveRunSpec,
  LiveSegmentFile,
  LiveTimers,
  TvChannelProbe,
} from '../../src/core/tv/live.ts'
import type { LiveSession, LiveSessionRepository } from '../../src/core/tv/live-session.ts'
import type { TvSource } from '../../src/core/tv/source.ts'
import { createManualClock } from './clock.ts'
import { createRecordingEventBus, createSequentialIds } from './fakes.ts'
import { createCapturingLogger } from './logger.ts'
import { inMemoryTvChannels, inMemoryTvSources } from './tv-world.ts'

/** Lets the promise chains settle (probe, process exits) between two steps of a test. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

/**
 * Timers on a manual clock: `advance(ms)` runs what falls due in order, letting the promises
 * each one starts settle before the next.
 */
export const createManualTimers = (clock: ReturnType<typeof createManualClock>) => {
  type Pending = { at: number; order: number; run: () => void }
  const pending = new Set<Pending>()
  let order = 0
  const timers: LiveTimers = {
    after: (ms, run) => {
      order += 1
      const entry = { at: clock.now().getTime() + ms, order, run }
      pending.add(entry)
      return () => {
        pending.delete(entry)
      }
    },
  }
  const advance = async (ms: number): Promise<void> => {
    const end = clock.now().getTime() + ms
    await settle()
    for (;;) {
      const next = [...pending]
        .filter((entry) => entry.at <= end)
        .sort((a, b) => a.at - b.at || a.order - b.order)[0]
      if (next === undefined) break
      pending.delete(next)
      clock.set(new Date(next.at))
      next.run()
      await settle()
    }
    clock.set(new Date(end))
    await settle()
  }
  return { timers, advance, pending: () => pending.size }
}

export const sampleProbe = (overrides: Partial<TvChannelProbe> = {}): TvChannelProbe => ({
  video: { codec: 'h264', width: 1920, height: 1080, fieldOrder: 'progressive' },
  audio: [{ index: 1, codec: 'aac', channels: 2, audioDescription: false }],
  ...overrides,
})

type ScriptedRun = {
  spec: LiveRunSpec
  segments: LiveSegmentFile[]
  /** Its stop was asked. */
  stopped: boolean
  /** Its process is gone. */
  gone: boolean
  /** Ends the run by itself (an upstream failure), or lets a held stop finish. */
  exit: (exitCode?: number) => void
}

/**
 * ffmpeg runs the test drives: it writes their segments and ends them. `holdStops()` makes a
 * stop wait until the test ends the run (`exit()`): a process slow to die. `journal` lists the
 * starts, exits and folder removals in order.
 */
export const scriptedLiveRelay = () => {
  const runs: ScriptedRun[] = []
  const removedRuns: string[] = []
  const removedStreams: string[] = []
  const journal: string[] = []
  let holding = false
  const runsOf = (channelId: string) => runs.filter((run) => run.spec.channelId === channelId)
  const relay: LiveRelay = {
    start: (spec) => {
      let finish: (exit: LiveRunExit) => void = () => {}
      const exited = new Promise<LiveRunExit>((resolve) => {
        finish = resolve
      })
      const run: ScriptedRun = {
        spec,
        segments: [],
        stopped: false,
        gone: false,
        exit: (exitCode = 1) => {
          if (run.gone) return
          run.gone = true
          journal.push(`exit ${spec.channelId}:${spec.run}`)
          finish({ exitCode, errorLines: '' })
        },
      }
      runs.push(run)
      journal.push(`start ${spec.channelId}:${spec.run}`)
      return {
        exited,
        stop: async () => {
          run.stopped = true
          if (!holding) run.exit(255)
          await exited
        },
      }
    },
    segmentsOf: ({ channelId, run }) =>
      runsOf(channelId).find((r) => r.spec.run === run)?.segments ?? [],
    removeRun: ({ channelId, run }) => {
      removedRuns.push(`${channelId}:${run}`)
    },
    removeStream: (channelId) => {
      removedStreams.push(channelId)
      journal.push(`remove ${channelId}`)
    },
    removeAll: () => {},
    fileOf: ({ channelId, name }) =>
      runsOf(channelId).some(
        (run) =>
          name === `init-${run.spec.run}.mp4` ||
          run.segments.some((segment) => segment.name === name),
      )
        ? `/live/${channelId}/${name}`
        : undefined,
  }
  return {
    relay,
    runs,
    removedRuns,
    removedStreams,
    journal,
    runsOf,
    /** Stops wait for the test to end the run (`exit()`) from now on. */
    holdStops: () => {
      holding = true
    },
    /** The channel's latest run. */
    current: (channelId: string): ScriptedRun => {
      const run = runsOf(channelId).at(-1)
      if (run === undefined) throw new Error(`no run of ${channelId}`)
      return run
    },
    /** The channel's latest run writes `count` segments of `durationS`. */
    write: (channelId: string, count = 1, durationS = 2) => {
      const run = runsOf(channelId).at(-1)
      if (run === undefined) throw new Error(`no run of ${channelId}`)
      for (let i = 0; i < count; i += 1) {
        const index = String(run.segments.length).padStart(5, '0')
        run.segments.push({ name: `seg-${run.spec.run}-${index}.m4s`, durationS })
      }
    },
  }
}

type HeldProbe = {
  url: string
  signal: AbortSignal
  /** ffprobe ends: with the scripted answer, or a failure once aborted. */
  settle: () => void
}

/**
 * A prober answering what the test scripts, per upstream URL (default: H.264 and AAC). `hold(url)`
 * keeps that upstream's probes running until the test settles them (`held`), aborted or not:
 * ffprobe outlives its abort until its process is gone.
 */
export const scriptedLiveProber = () => {
  const answers = new Map<string, Result<TvChannelProbe, LiveProbeError>>()
  const calls: string[] = []
  const holding = new Set<string>()
  const held: HeldProbe[] = []
  const answerOf = (url: string, signal: AbortSignal): Result<TvChannelProbe, LiveProbeError> =>
    signal.aborted
      ? err(appError('tv/stream_unavailable', 'scripted probe aborted'))
      : (answers.get(url) ?? ok(sampleProbe()))
  const prober: LiveProber = {
    probe: async ({ upstream, signal }) => {
      calls.push(upstream.url)
      if (!holding.has(upstream.url)) return answerOf(upstream.url, signal)
      return new Promise((resolve) => {
        held.push({
          url: upstream.url,
          signal,
          settle: () => resolve(answerOf(upstream.url, signal)),
        })
      })
    },
  }
  return {
    prober,
    calls,
    held,
    hold: (url: string) => {
      holding.add(url)
    },
    answer: (url: string, probe: TvChannelProbe) => {
      answers.set(url, ok(probe))
    },
    fail: (url: string) => {
      answers.set(url, err(appError('tv/stream_unavailable', 'scripted probe failure')))
    },
    restore: (url: string) => {
      answers.delete(url)
    },
  }
}

/** Live sessions in memory, like `createLiveSessionStore`. */
export const inMemoryLiveSessions = () => {
  const rows = new Map<string, LiveSession>()
  const repository: LiveSessionRepository = {
    insert: (session) => {
      rows.set(session.id, session)
    },
    findById: (id) => rows.get(id),
    heartbeat: ({ id, at }) => {
      const session = rows.get(id)
      if (session !== undefined) rows.set(id, { ...session, lastHeartbeatAt: at })
    },
    remove: (id) => {
      rows.delete(id)
    },
    list: () => [...rows.values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()),
  }
  return { repository, rows }
}

const sourceAt = (id: string, maxConnections?: number): TvSource => ({
  id,
  name: `Source ${id}`,
  settings: { kind: 'm3u', playlistUrl: `http://provider.test/${id}.m3u` },
  ...(maxConnections === undefined ? {} : { maxConnections }),
  createdAt: new Date('2026-06-01T00:00:00.000Z'),
  failureCount: 0,
})

/**
 * The relay and the live sessions (§29.4) over a scripted relay and prober, manual timers and
 * clock, sources and channels in memory. `addChannel` adds an enabled channel of a source.
 */
export const createLiveWorld = () => {
  const clock = createManualClock(new Date('2026-06-10T20:00:00.000Z'))
  const { timers, advance, pending } = createManualTimers(clock)
  const relay = scriptedLiveRelay()
  const prober = scriptedLiveProber()
  const sources = inMemoryTvSources()
  const channels = inMemoryTvChannels()
  const sessions = inMemoryLiveSessions()
  const { bus: eventBus, events } = createRecordingEventBus()
  const logs = createCapturingLogger()
  const ids = createSequentialIds('live-')
  const tvChannels = channels.repository
  const tvSources = sources.repository
  const liveSessions = sessions.repository
  const logger = logs.logger

  const streams = liveStreamsFactory({
    relay: relay.relay,
    prober: prober.prober,
    probeCache: tvChannels,
    timers,
    clock,
    logger,
  })
  const endLiveSession = endLiveSessionFactory({ liveSessions, streams, eventBus, logger })
  const hashSecret = (secret: string) => `hash:${secret}`
  let secrets = 0
  const authorize = authorizeLiveStreamFactory({ liveSessions, endLiveSession, hashSecret, clock })

  const addSource = (id: string, maxConnections?: number) => {
    tvSources.save(sourceAt(id, maxConnections))
  }
  const addChannel = (
    id: string,
    { sourceId = 'source-1', enabled = true }: { sourceId?: string; enabled?: boolean } = {},
  ): TvChannel => {
    if (tvSources.findById(sourceId) === undefined) addSource(sourceId)
    const channel: TvChannel = {
      id,
      sourceId,
      key: `name:|${id}`,
      name: `Channel ${id}`,
      groupId: `${sourceId}-group`,
      position: channels.channels.size,
      upstream: { url: `http://provider.test/live/${id}.ts?token=secret` },
      enabled,
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    }
    channels.groups.set(channel.groupId, {
      id: channel.groupId,
      sourceId,
      name: '',
      enabled: true,
      position: 0,
    })
    channels.channels.set(id, channel)
    return channel
  }

  /** Time passes while the channel's run writes a 2 s segment every 2 s. */
  const play = async (channelId: string, ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 2_000) {
      relay.write(channelId)
      await advance(Math.min(2_000, ms - elapsed))
    }
  }

  const join = (sessionId: string, channelId: string) => {
    const channel = channels.channels.get(channelId)
    if (channel === undefined) throw new Error(`no channel ${channelId}`)
    return streams.join({
      sessionId,
      channel: { id: channel.id, sourceId: channel.sourceId },
      upstream: channel.upstream,
      maxConnections: tvSources.findById(channel.sourceId)?.maxConnections,
    })
  }

  return {
    clock,
    advance,
    play,
    join,
    pendingTimers: pending,
    relay,
    prober,
    sources,
    channels,
    sessions,
    events,
    logs,
    streams,
    addSource,
    addChannel,
    createLiveSession: createLiveSessionFactory({
      tvChannels,
      tvSources,
      provider: { upstreamOf: ({ upstream }) => upstream },
      liveSessions,
      streams,
      streamSecrets: {
        generate: () => {
          secrets += 1
          return `secret-${secrets}`
        },
        hash: hashSecret,
      },
      clock,
      ids,
      logger,
    }),
    recordLiveHeartbeat: recordLiveHeartbeatFactory({
      liveSessions,
      tvChannels,
      streams,
      endLiveSession,
      clock,
    }),
    stopLiveSession: stopLiveSessionFactory({ liveSessions, endLiveSession }),
    stopLiveSessionAsAdmin: stopLiveSessionAsAdminFactory({
      liveSessions,
      endLiveSession,
      logger,
    }),
    listLiveSessions: listLiveSessionsFactory({
      liveSessions,
      directory: {
        describe: (live) =>
          live.map((session) => ({
            id: session.id,
            account: { id: session.accountId, name: session.accountId },
            profile: { id: session.profileId, name: session.profileId, color: 'blue' },
            channel: { id: session.channelId, name: session.channelId },
            rendition: session.rendition,
            startedAt: session.startedAt,
            lastHeartbeatAt: session.lastHeartbeatAt,
          })),
      },
      clock,
    }),
    sweepLiveSessions: sweepLiveSessionsFactory({ liveSessions, endLiveSession, clock }),
    getLivePlaylist: getLivePlaylistFactory({ authorize, streams, endLiveSession }),
    getLiveFile: getLiveFileFactory({ authorize, streams, endLiveSession }),
  }
}

export type LiveWorld = ReturnType<typeof createLiveWorld>

/** A world with a ready session of `leo` (auth session `leo-auth`) on channel `a`. */
export const createWorldWithSession = async () => {
  const world = createLiveWorld()
  world.addChannel('a')
  const opening = world.createLiveSession({
    channelId: 'a',
    accountId: 'leo',
    profileId: 'leo-profile',
    authSessionId: 'leo-auth',
    capabilities: { videoCodecs: ['avc1'], audioCodecs: ['mp4a.40.2'], hls: 'mse' },
  })
  await world.advance(0)
  world.relay.write('a', 2)
  await world.advance(500)
  const created = await opening
  if (!created.ok) throw new Error(`no session: ${created.error.code}`)
  return { world, session: created.value.session, secret: created.value.streamSecret }
}
