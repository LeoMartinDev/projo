import { appError, err, ok, type Result } from '@projo/shared'
import type { TvRendition } from '@projo/shared/api/tv'

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
  LiveCompatSpec,
  LiveProbeError,
  LiveProber,
  LiveRelay,
  LiveRunExit,
  LiveRunSpec,
  LiveSegmentFile,
  LiveStreamKey,
  LiveTimers,
  TvChannelProbe,
} from '../../src/core/tv/live.ts'
import type { LiveSession, LiveSessionRepository } from '../../src/core/tv/live-session.ts'
import type { TvSource } from '../../src/core/tv/source.ts'
import { transcodeSlotsFactory } from '../../src/application/playback/transcode-slots.ts'
import type { Clock } from '../../src/core/clock.ts'
import type { Logger } from '../../src/core/logger.ts'
import type { TranscodeSlots } from '../../src/core/playback/transcode-slots.ts'
import { defaultPlaybackSettings } from '../../src/core/settings/settings.ts'
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

type ScriptedRunState = {
  /** Its run number in its stream. */
  number: number
  segments: LiveSegmentFile[]
  /** Its stop was asked. */
  stopped: boolean
  /** Its process is gone. */
  gone: boolean
  /** Ends the run by itself (an upstream failure), or lets a held stop finish. */
  exit: (exitCode?: number) => void
}

type ScriptedRun = ScriptedRunState & { spec: LiveRunSpec }

type ScriptedCompatRun = ScriptedRunState & {
  spec: LiveCompatSpec
  /** The copy segments fed to it, in order (its init is implied by `spec.copyRun`). */
  fed: string[]
  /** Segments fed that ffmpeg has not taken yet (set by the test; 0 by default). */
  backlog: number
}

/** `a` for channel a's copy stream, `a/compat` for its compat stream. */
const streamNameOf = ({ channelId, rendition }: LiveStreamKey): string =>
  rendition === 'copy' ? channelId : `${channelId}/compat`

/**
 * ffmpeg runs the test drives: it writes their segments and ends them. `holdStops()` makes a
 * stop wait until the test ends the run (`exit()`): a process slow to die. `journal` lists the
 * starts, exits and folder removals in order. Copy runs are named by their channel (`a:1`),
 * compat runs by their stream (`a/compat:1`).
 */
export const scriptedLiveRelay = () => {
  const runs: ScriptedRun[] = []
  const compatRuns: ScriptedCompatRun[] = []
  const removedRuns: string[] = []
  const removedStreams: string[] = []
  const journal: string[] = []
  let holding = false
  const runsOf = (channelId: string) => runs.filter((run) => run.spec.channelId === channelId)
  const compatRunsOf = (channelId: string) =>
    compatRuns.filter((run) => run.spec.channelId === channelId)
  const runsOfKey = (key: LiveStreamKey): ScriptedRunState[] =>
    key.rendition === 'copy' ? runsOf(key.channelId) : compatRunsOf(key.channelId)

  /** A scripted process named `name` (`a:1`): its exit, and a stop held while `holdStops()`. */
  const scripted = (name: string, number: number) => {
    let finish: (exit: LiveRunExit) => void = () => {}
    const exited = new Promise<LiveRunExit>((resolve) => {
      finish = resolve
    })
    const state: ScriptedRunState = {
      number,
      segments: [],
      stopped: false,
      gone: false,
      exit: (exitCode = 1) => {
        if (state.gone) return
        state.gone = true
        journal.push(`exit ${name}`)
        finish({ exitCode, errorLines: '' })
      },
    }
    journal.push(`start ${name}`)
    const handle = {
      exited,
      stop: async () => {
        state.stopped = true
        if (!holding) state.exit(255)
        await exited
      },
    }
    return { state, handle }
  }

  const relay: LiveRelay = {
    start: (spec) => {
      const { state, handle } = scripted(`${spec.channelId}:${spec.run}`, spec.run)
      const run: ScriptedRun = Object.assign(state, { spec })
      runs.push(run)
      return handle
    },
    startCompat: (spec) => {
      const { state, handle } = scripted(`${spec.channelId}/compat:${spec.run}`, spec.run)
      const run: ScriptedCompatRun = Object.assign(state, { spec, fed: [] as string[], backlog: 0 })
      compatRuns.push(run)
      return {
        ...handle,
        feed: (name: string) => void run.fed.push(name),
        backlog: () => run.backlog,
      }
    },
    segmentsOf: ({ run, ...key }) => runsOfKey(key).find((r) => r.number === run)?.segments ?? [],
    removeRun: ({ run, ...key }) => {
      removedRuns.push(`${streamNameOf(key)}:${run}`)
    },
    removeStream: (key) => {
      removedStreams.push(streamNameOf(key))
      journal.push(`remove ${streamNameOf(key)}`)
    },
    removeAll: () => {},
    fileOf: ({ name, ...key }) =>
      runsOfKey(key).some(
        (run) =>
          name === `init-${run.number}.mp4` ||
          run.segments.some((segment) => segment.name === name),
      )
        ? `/live/${streamNameOf(key)}/${name}`
        : undefined,
  }
  const latest = <T>(list: T[], name: string): T => {
    const run = list.at(-1)
    if (run === undefined) throw new Error(`no run of ${name}`)
    return run
  }
  const writeTo = (run: ScriptedRunState, count: number, durationS: number) => {
    for (let i = 0; i < count; i += 1) {
      const index = String(run.segments.length).padStart(5, '0')
      run.segments.push({ name: `seg-${run.number}-${index}.m4s`, durationS })
    }
  }
  return {
    relay,
    runs,
    compatRuns,
    removedRuns,
    removedStreams,
    journal,
    runsOf,
    compatRunsOf,
    /** Stops wait for the test to end the run (`exit()`) from now on. */
    holdStops: () => {
      holding = true
    },
    /** The channel's latest copy run. */
    current: (channelId: string): ScriptedRun => latest(runsOf(channelId), channelId),
    /** The channel's latest compat run. */
    currentCompat: (channelId: string): ScriptedCompatRun =>
      latest(compatRunsOf(channelId), `${channelId}/compat`),
    /** The channel's latest copy run writes `count` segments of `durationS`. */
    write: (channelId: string, count = 1, durationS = 2) => {
      writeTo(latest(runsOf(channelId), channelId), count, durationS)
    },
    /** The channel's latest compat run writes `count` segments of `durationS`. */
    writeCompat: (channelId: string, count = 1, durationS = 2) => {
      writeTo(latest(compatRunsOf(channelId), `${channelId}/compat`), count, durationS)
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
    setRendition: ({ id, rendition }) => {
      const session = rows.get(id)
      if (session !== undefined) rows.set(id, { ...session, rendition })
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
 * The playback module's transcode slots (§29.4, §10.3) with a settable `limit`, no playback
 * transcode running; `holders` lists the compat streams holding one, `evicted` those evicted.
 */
export const observedTranscodeSlots = ({
  limit,
  clock,
  logger,
}: {
  limit: number
  clock: Clock
  logger: Logger
}) => {
  const state = { limit }
  const slots = transcodeSlotsFactory({
    sessionRepository: { listActive: () => [] },
    playbackSettings: {
      read: () => ({ ...defaultPlaybackSettings, maxConcurrentTranscodes: state.limit }),
    },
    clock,
    logger,
  })
  const holders = new Set<string>()
  const evicted: string[] = []
  const observed: TranscodeSlots = {
    acquire: (id, holder) => {
      const acquired = slots.acquire(id, {
        idleOrder: holder.idleOrder,
        evict: () => {
          evicted.push(id)
          holders.delete(id)
          holder.evict()
        },
      })
      if (acquired.ok) holders.add(id)
      return acquired
    },
    release: (id) => {
      holders.delete(id)
      slots.release(id)
    },
    admitPlayback: (playing) => slots.admitPlayback(playing),
  }
  return { slots: observed, holders, evicted, state }
}

/**
 * The relay and the live sessions (§29.4) over a scripted relay and prober, manual timers and
 * clock, sources and channels in memory, transcode slots in memory (`transcodeLimit`).
 * `addChannel` adds an enabled channel of a source.
 */
export const createLiveWorld = ({ transcodeLimit = 2 }: { transcodeLimit?: number } = {}) => {
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
  const transcodes = observedTranscodeSlots({ limit: transcodeLimit, clock, logger })

  const streams = liveStreamsFactory({
    relay: relay.relay,
    prober: prober.prober,
    probeCache: tvChannels,
    transcodeSlots: transcodes.slots,
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

  const join = (sessionId: string, channelId: string, rendition: TvRendition = 'copy') => {
    const channel = channels.channels.get(channelId)
    if (channel === undefined) throw new Error(`no channel ${channelId}`)
    return streams.join({
      sessionId,
      channel: { id: channel.id, sourceId: channel.sourceId },
      upstream: channel.upstream,
      maxConnections: tvSources.findById(channel.sourceId)?.maxConnections,
      rendition,
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
    transcodes,
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
