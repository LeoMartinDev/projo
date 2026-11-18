import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { TvRendition } from '@projo/shared/api/tv'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TranscodeLimitReached, TranscodeSlots } from '../../core/playback/transcode-slots.ts'
import type { TvUpstream } from '../../core/tv/channel.ts'
import { type LiveConnectionError, planLiveConnection } from '../../core/tv/live-connections.ts'
import {
  liveTargetDurationOf,
  type LiveWindowSegment,
  renderLivePlaylist,
  servedWindow,
  windowFrom,
} from '../../core/tv/live-playlist.ts'
import {
  cacheTrimOf,
  expiredDeletionAt,
  liveExpiredGraceS,
  segmentStartsOf,
} from '../../core/tv/live-window.ts'
import {
  defaultLiveLimits,
  isLiveFileName,
  liveAudioOf,
  type LiveLimits,
  type LiveProbeCache,
  type LiveProber,
  type LiveRelay,
  type LiveRun,
  type LiveSegmentFile,
  type LiveStreamKey,
  type LiveTimers,
  liveTimings,
  type TvChannelProbe,
  upstreamHostOf,
} from '../../core/tv/live.ts'
import { isInterlaced } from '../../core/tv/rendition.ts'

export type LiveStreamError = AppError<'tv/stream_unavailable'>
export type LiveFileError = AppError<'tv/stream_unavailable' | 'tv/segment_not_found'>
export type LiveJoinError = LiveConnectionError | TranscodeLimitReached

type Timings = {
  pollMs: number
  stallMs: number
  idleStopMs: number
  retryDelaysMs: readonly number[]
  readyTimeoutMs: number
  readySegments: number
  compatBacklogSegments: number
  /** How long a segment out of the window stays on disk past its duration (§29.4). */
  expiredGraceS: number
}

type Deps = {
  relay: LiveRelay
  prober: LiveProber
  probeCache: LiveProbeCache
  transcodeSlots: Pick<TranscodeSlots, 'acquire' | 'release'>
  timers: LiveTimers
  clock: Clock
  logger: Logger
  /** The replay window and the cache's cap (§29.4), read at each poll. */
  limits?: () => LiveLimits
  timings?: Partial<Timings>
}

/** A segment out of the window, kept on disk until `deleteAtMs` (§29.4). */
type ExpiredSegment = LiveWindowSegment & { deleteAtMs: number }

/** The live cache's cap is logged at most this often when it shortens windows. */
const capLogEveryMs = 60_000

type ActiveRun = {
  number: number
  handle: LiveRun
  /** Index of the last segment appended from this run. */
  lastIndex: number
  sawSegment: boolean
  quietPolls: number
  /** Stopped on purpose (idle, eviction, shutdown, a new copy run): its exit is no failure. */
  stopping: boolean
  /** A compat run: the copy run it is fed, and how far behind that input it is. */
  input?: { copyRun: number; feed: (name: string) => void; backlog: () => number }
}

type Stream = {
  /** `<channel>` for the copy, `<channel>/compat` for the compat stream. */
  key: string
  channelId: string
  rendition: TvRendition
  sourceId: string
  upstream: TvUpstream
  host: string
  viewers: Set<string>
  idleOrder?: number
  failed: boolean
  closed: boolean
  runs: number
  failures: number
  run?: ActiveRun
  /** A copy stream: the probe its runs were started from (what its compat stream decodes). */
  probe?: TvChannelProbe
  /** The replay window (§29.4), oldest first. */
  window: LiveWindowSegment[]
  /** Segments out of the window, on disk for their grace, oldest first. */
  expired: ExpiredSegment[]
  /** The end of the stream's newest segment on the relay's clock: the next run starts after. */
  lastEndMs?: number
  nextSequence: number
  /** `#EXT-X-TARGETDURATION`, pinned by the stream's first segment: it never changes. */
  targetS?: number
  /** A segment longer than the target was logged (once per stream). */
  overlongLogged: boolean
  discontinuity: number
  lastRun?: number
  /** Runs whose files may still be on disk. */
  runsOnDisk: Set<number>
  /** The probe under way: a stop aborts it and waits for ffprobe to be gone. */
  probing?: { controller: AbortController; settled: Promise<unknown> }
  /**
   * Stops to wait for before the next attempt: a copy's, every stop of its source under way; a
   * compat's, the earlier compat stream of its channel (whose folder it reuses).
   */
  before: Promise<unknown>
  cancelPoll?: () => void
  cancelIdle?: () => void
  cancelRetry?: () => void
  listeners: Set<() => void>
  /** A compat stream: the copy stream it reads. */
  copy?: Stream
  /** A compat stream is a viewer of its copy while it has viewers of its own. */
  holdsCopy: boolean
  /** A compat stream holds a transcode slot from its start to its stop or failure. */
  holdsSlot: boolean
}

type StreamState = 'ready' | 'closed' | 'failed'

const segmentIndexOf = (name: string): number => {
  const index = /-(\d+)\.m4s$/u.exec(name)?.[1]
  return index === undefined ? -1 : Number(index)
}

const keyOf = ({ channelId, rendition }: LiveStreamKey): string =>
  rendition === 'copy' ? channelId : `${channelId}/compat`

/** The viewer a compat stream is of its copy stream. */
const compatViewerOf = (channelId: string): string => `compat:${channelId}`

/** The holder of a compat stream's transcode slot. */
const slotHolderOf = (channelId: string): string => `live:${channelId}`

const unavailable = (channelId: string, reason: string): Result<never, LiveStreamError> =>
  err(
    appError('tv/stream_unavailable', 'the channel stream is unavailable', {
      context: { channelId, reason },
    }),
  )

/**
 * The channel streams (§29.4): one ffmpeg run at a time per stream, shared by its viewers,
 * probed, restarted after a failure, stopped once idle, within its source's connection limit.
 * A channel's `compat` stream reads its `copy` stream, of which it is a viewer, and holds a
 * transcode slot. Holds every stream in memory, with its timers.
 */
export const liveStreamsFactory = ({
  relay,
  prober,
  probeCache,
  transcodeSlots,
  timers,
  clock,
  logger,
  limits = () => defaultLiveLimits,
  timings: overrides = {},
}: Deps) => {
  const timings: Timings = { ...liveTimings, expiredGraceS: liveExpiredGraceS, ...overrides }
  const streams = new Map<string, Stream>()
  let capLoggedAt: number | undefined
  /** Stops under way; those of copy streams may still hold an upstream connection. */
  const stopping = new Set<{
    key: string
    sourceId: string
    connection: boolean
    done: Promise<void>
  }>()
  let idleCounter = 0

  const notify = (stream: Stream): void => {
    for (const listener of [...stream.listeners]) listener()
  }

  const fields = (stream: Stream) => ({
    channelId: stream.channelId,
    rendition: stream.rendition,
    upstream: stream.host,
  })

  const cancelTimers = (stream: Stream): void => {
    stream.cancelPoll?.()
    stream.cancelIdle?.()
    stream.cancelRetry?.()
    delete stream.cancelPoll
    delete stream.cancelIdle
    delete stream.cancelRetry
  }

  const stopsOf = (sourceId: string): Promise<void>[] =>
    [...stopping]
      .filter((stop) => stop.connection && stop.sourceId === sourceId)
      .map((stop) => stop.done)

  const stopsOfKey = (key: string): Promise<void>[] =>
    [...stopping].filter((stop) => stop.key === key).map((stop) => stop.done)

  const compatOf = (copy: Stream): Stream | undefined => {
    const compat = streams.get(keyOf({ channelId: copy.channelId, rendition: 'compat' }))
    return compat?.copy === copy ? compat : undefined
  }

  /** Whether the stream is ready, closed or failed; `undefined` while it starts. */
  const stateOf = (stream: Stream): StreamState | undefined => {
    if (stream.closed) return 'closed'
    if (stream.failed) return 'failed'
    return stream.window.length >= timings.readySegments ? 'ready' : undefined
  }

  /** Settles once the stream is ready, closed or failed. */
  const settledOf = (stream: Stream): Promise<StreamState> =>
    new Promise((resolve) => {
      const now = stateOf(stream)
      if (now !== undefined) {
        resolve(now)
        return
      }
      const listener = () => {
        const state = stateOf(stream)
        if (state === undefined) return
        stream.listeners.delete(listener)
        resolve(state)
      }
      stream.listeners.add(listener)
    })

  const keepWatched = (stream: Stream, viewerId: string): void => {
    stream.viewers.add(viewerId)
    stream.cancelIdle?.()
    delete stream.cancelIdle
    delete stream.idleOrder
    const copy = stream.copy
    if (copy !== undefined && !stream.holdsCopy && !copy.closed && !copy.failed) {
      stream.holdsCopy = true
      keepWatched(copy, compatViewerOf(stream.channelId))
    }
  }

  /** A compat stream lets its copy go (no viewer left, stopped or failed). */
  const releaseCopy = (stream: Stream): void => {
    if (!stream.holdsCopy || stream.copy === undefined) return
    stream.holdsCopy = false
    leaveViewer(stream.copy, compatViewerOf(stream.channelId))
  }

  const releaseSlot = (stream: Stream): void => {
    if (!stream.holdsSlot) return
    stream.holdsSlot = false
    transcodeSlots.release(slotHolderOf(stream.channelId))
  }

  /**
   * Kills the stream's run or aborts its probe, then deletes its folder. Settles once neither
   * process is left; the stream's next start waits for it.
   */
  const halt = (stream: Stream): Promise<void> => {
    const run = stream.run
    delete stream.run
    const probing = stream.probing
    delete stream.probing
    probing?.controller.abort()
    const done = (async () => {
      if (run !== undefined) {
        run.stopping = true
        await run.handle.stop()
      }
      await probing?.settled
      relay.removeStream(stream)
    })()
    const entry = {
      key: stream.key,
      sourceId: stream.sourceId,
      connection: stream.rendition === 'copy',
      done,
    }
    stopping.add(entry)
    void done.then(() => stopping.delete(entry))
    return done
  }

  /** Stops a stream (and a copy's compat stream). Settles once its processes are gone. */
  const stopStream = (stream: Stream, reason: string): Promise<void> => {
    if (streams.get(stream.key) === stream) streams.delete(stream.key)
    if (stream.closed) return Promise.all(stopsOf(stream.sourceId)).then(() => {})
    stream.closed = true
    cancelTimers(stream)
    notify(stream)
    const compat = stream.rendition === 'copy' ? compatOf(stream) : undefined
    if (compat !== undefined) void stopStream(compat, reason)
    releaseSlot(stream)
    releaseCopy(stream)
    const done = halt(stream)
    logger.info('live stream stopped', { ...fields(stream), reason })
    return done
  }

  /**
   * Ends the stream as failed: its sessions are answered `tv/stream_unavailable`, and it stays
   * known (failed) while it has viewers, so that a new start counts them again. A copy's
   * failure fails its compat stream the same way.
   */
  const markFailed = (stream: Stream, reason?: string): void => {
    stream.failed = true
    cancelTimers(stream)
    stream.window = []
    stream.expired = []
    stream.runsOnDisk.clear()
    void halt(stream)
    logger.warn('live stream unavailable', {
      ...fields(stream),
      code: 'tv/stream_unavailable',
      attempts: stream.failures,
      ...(reason === undefined ? {} : { reason }),
    })
    if (stream.rendition === 'copy') {
      // Its probe may be what failed it: the next start probes again (§29.4).
      probeCache.recordProbe({ id: stream.channelId, at: clock.now() })
      const compat = compatOf(stream)
      if (compat !== undefined && !compat.closed && !compat.failed) {
        markFailed(compat, 'copy_failed')
      }
    }
    releaseSlot(stream)
    releaseCopy(stream)
    notify(stream)
    if (stream.viewers.size === 0 && streams.get(stream.key) === stream) {
      streams.delete(stream.key)
    }
  }

  const failAttempt = (stream: Stream, reason: string): void => {
    if (stream.closed || stream.failed) return
    stream.failures += 1
    const delay = timings.retryDelaysMs[stream.failures - 1]
    if (delay === undefined) {
      markFailed(stream)
      return
    }
    logger.info('live stream retrying', { ...fields(stream), reason, attempt: stream.failures })
    stream.cancelRetry = timers.after(delay, () => {
      delete stream.cancelRetry
      if (!stream.closed && !stream.failed) void attempt(stream)
    })
  }

  const append = (
    stream: Stream,
    run: number,
    segment: LiveSegmentFile,
    startMs: number,
    bytes: number,
  ): void => {
    if (stream.lastRun !== undefined && stream.lastRun !== run) stream.discontinuity += 1
    stream.lastRun = run
    stream.targetS ??= liveTargetDurationOf(segment.durationS)
    if (Math.round(segment.durationS) > stream.targetS && !stream.overlongLogged) {
      // The target never changes (RFC 8216): the segment is served as it is; players cope.
      stream.overlongLogged = true
      logger.warn('live segment longer than the target duration', {
        ...fields(stream),
        durationS: segment.durationS,
        targetS: stream.targetS,
      })
    }
    stream.window.push({
      run,
      name: segment.name,
      durationS: segment.durationS,
      sequence: stream.nextSequence,
      discontinuity: stream.discontinuity,
      startMs,
      bytes,
    })
    stream.lastEndMs = startMs + Math.round(segment.durationS * 1000)
    stream.nextSequence += 1
  }

  /** Moves the `count` oldest segments of the window out of it: deleted after their grace. */
  const expire = (stream: Stream, count: number, nowMs: number): void => {
    for (const segment of stream.window.splice(0, count)) {
      stream.expired.push({
        ...segment,
        deleteAtMs: expiredDeletionAt(segment, nowMs, timings.expiredGraceS),
      })
    }
  }

  /**
   * Deletes the segments whose grace is over (§29.4); a finished run's init and playlist go once
   * none of its segments is left, in the window or awaiting deletion.
   */
  const purge = (stream: Stream, nowMs: number): void => {
    const key = { channelId: stream.channelId, rendition: stream.rendition }
    while ((stream.expired[0]?.deleteAtMs ?? Number.POSITIVE_INFINITY) <= nowMs) {
      const segment = stream.expired.shift()
      if (segment !== undefined) relay.removeSegment({ ...key, name: segment.name })
    }
    const kept = new Set([...stream.window, ...stream.expired].map((segment) => segment.run))
    for (const run of [...stream.runsOnDisk]) {
      if (run === stream.run?.number || kept.has(run)) continue
      stream.runsOnDisk.delete(run)
      relay.removeRun({ ...key, run })
    }
  }

  /** Slides the window to the setting's length, then purges what is due. */
  const slide = (stream: Stream): void => {
    const nowMs = clock.now().getTime()
    const kept = servedWindow(stream.window, limits().windowS)
    expire(stream, stream.window.length - kept.length, nowMs)
    purge(stream, nowMs)
  }

  /**
   * Keeps the live cache under its cap (§29.4): the oldest segments of all streams leave their
   * windows first, no window shortened below its newest 30 s.
   */
  const enforceCacheCap = (): void => {
    const live = [...streams.values()].filter((stream) => !stream.closed && !stream.failed)
    const trims = cacheTrimOf(
      new Map(live.map((stream) => [stream.key, stream.window])),
      limits().cacheMaxBytes,
    )
    if (trims.size === 0) return
    const nowMs = clock.now().getTime()
    for (const [key, count] of trims) {
      const stream = streams.get(key)
      if (stream === undefined) continue
      expire(stream, count, nowMs)
      purge(stream, nowMs)
    }
    if (capLoggedAt === undefined || nowMs - capLoggedAt >= capLogEveryMs) {
      capLoggedAt = nowMs
      logger.warn('live cache full: replay windows shortened', {
        streams: [...trims.keys()].length,
        segments: [...trims.values()].reduce((sum, count) => sum + count, 0),
      })
    }
  }

  const launch = (
    stream: Stream,
    handle: LiveRun,
    details: Record<string, unknown>,
    input?: ActiveRun['input'],
  ): void => {
    const run: ActiveRun = {
      number: stream.runs,
      handle,
      lastIndex: -1,
      sawSegment: false,
      quietPolls: 0,
      stopping: false,
      ...(input === undefined ? {} : { input }),
    }
    stream.run = run
    stream.runsOnDisk.add(run.number)
    logger.info('live stream run started', { ...fields(stream), run: run.number, ...details })
    stream.cancelPoll = timers.after(timings.pollMs, () => poll(stream, run))
    void handle.exited.then((exit) => onExit(stream, run, exit))
  }

  /**
   * Starts a compat run on the copy's newest run: its init, then its newest segments (a fast
   * start); later segments are fed as the copy lists them.
   */
  const launchCompat = (compat: Stream, copy: Stream): void => {
    const copyRun = copy.lastRun
    const probe = copy.probe
    if (copyRun === undefined || probe === undefined) {
      failAttempt(compat, 'no_input')
      return
    }
    compat.runs += 1
    const handle = relay.startCompat({
      channelId: compat.channelId,
      run: compat.runs,
      copyRun,
      video: probe.video,
    })
    launch(
      compat,
      handle,
      { copyRun, interlaced: isInterlaced(probe.video), codec: probe.video.codec },
      { copyRun, feed: handle.feed, backlog: handle.backlog },
    )
    const newest = copy.window
      .filter((segment) => segment.run === copyRun)
      .slice(-timings.readySegments)
    for (const segment of newest) handle.feed(segment.name)
  }

  /** Stops the compat run and starts a new one at once on the copy's newest segments. */
  const restartCompat = (compat: Stream, copy: Stream, run: ActiveRun): void => {
    run.stopping = true
    delete compat.run
    compat.cancelPoll?.()
    delete compat.cancelPoll
    void run.handle.stop()
    launchCompat(compat, copy)
  }

  /**
   * New copy segments reach the copy's compat run. A new copy run (new timestamps, a new init),
   * or a compat run too far behind its input once it lists segments (slower than real time: the
   * copy would delete segments it has not read yet), starts a new compat run at once: not a
   * failed attempt.
   */
  const feedCompat = (copy: Stream, copyRun: number, fresh: readonly LiveSegmentFile[]): void => {
    const compat = compatOf(copy)
    const run = compat?.run
    if (compat === undefined || compat.closed || compat.failed || run === undefined) return
    if (run.stopping || run.input === undefined) return
    if (run.input.copyRun !== copyRun) {
      restartCompat(compat, copy, run)
      return
    }
    for (const segment of fresh) run.input.feed(segment.name)
    const behind = run.input.backlog()
    // A run that lists nothing yet is left to the stall rule: a failed attempt.
    if (run.sawSegment && behind > timings.compatBacklogSegments) {
      logger.warn('live compat stream behind its input, starting it again', {
        ...fields(compat),
        run: run.number,
        segments: behind,
      })
      restartCompat(compat, copy, run)
    }
  }

  const poll = (stream: Stream, run: ActiveRun): void => {
    delete stream.cancelPoll
    if (stream.closed || stream.failed || stream.run !== run || run.stopping) return
    const fresh = relay
      .segmentsOf({ channelId: stream.channelId, rendition: stream.rendition, run: run.number })
      .filter(
        (segment) => isLiveFileName(segment.name) && segmentIndexOf(segment.name) > run.lastIndex,
      )
    if (fresh.length > 0) {
      const wasReady = stream.window.length >= timings.readySegments
      const starts = segmentStartsOf({
        durationsS: fresh.map((segment) => segment.durationS),
        nowMs: clock.now().getTime(),
        firstOfRun: !run.sawSegment,
        previousEndMs: stream.lastEndMs,
      })
      const key = { channelId: stream.channelId, rendition: stream.rendition }
      fresh.forEach((segment, index) => {
        const startMs = starts[index] ?? stream.lastEndMs ?? clock.now().getTime()
        append(stream, run.number, segment, startMs, relay.sizeOf({ ...key, name: segment.name }))
      })
      run.lastIndex = segmentIndexOf(fresh.at(-1)?.name ?? '')
      run.quietPolls = 0
      run.sawSegment = true
      stream.failures = 0
      slide(stream)
      enforceCacheCap()
      if (!wasReady && stream.window.length >= timings.readySegments) {
        logger.info('live stream ready', fields(stream))
      }
      if (stream.rendition === 'copy') feedCompat(stream, run.number, fresh)
      notify(stream)
    } else {
      run.quietPolls += 1
      if (run.quietPolls * timings.pollMs >= timings.stallMs) {
        logger.warn('live stream stalled', { ...fields(stream), run: run.number })
        void run.handle.stop()
        return
      }
    }
    stream.cancelPoll = timers.after(timings.pollMs, () => poll(stream, run))
  }

  const onExit = (
    stream: Stream,
    run: ActiveRun,
    exit: { exitCode: number; errorLines: string },
  ) => {
    if (stream.run === run) {
      delete stream.run
      stream.cancelPoll?.()
      delete stream.cancelPoll
    }
    if (run.stopping || stream.closed || stream.failed) return
    logger.warn('live stream run ended', {
      ...fields(stream),
      run: run.number,
      exitCode: exit.exitCode,
      ...(exit.errorLines === '' ? {} : { stderr: exit.errorLines }),
    })
    // A copy run that listed nothing may have been started from a stale probe: probe again.
    if (!run.sawSegment && stream.rendition === 'copy') {
      probeCache.recordProbe({ id: stream.channelId, at: clock.now() })
    }
    failAttempt(stream, 'run_ended')
  }

  /**
   * A compat attempt starts once the channel's earlier compat stream is gone (its folder is
   * this one's) and its copy is ready; the copy's stop or failure stops it.
   */
  const attemptCompat = async (stream: Stream): Promise<void> => {
    await stream.before
    stream.before = Promise.resolve()
    const copy = stream.copy
    if (copy === undefined || stream.closed || stream.failed) return
    const state = await settledOf(copy)
    if (stream.closed || stream.failed || state !== 'ready') return
    launchCompat(stream, copy)
  }

  const attempt = async (stream: Stream): Promise<void> => {
    if (stream.rendition === 'compat') {
      await attemptCompat(stream)
      return
    }
    await stream.before
    stream.before = Promise.resolve()
    if (stream.closed || stream.failed) return
    let probe = probeCache.probeOf(stream.channelId)
    if (probe === undefined) {
      const controller = new AbortController()
      const probing = prober.probe({ upstream: stream.upstream, signal: controller.signal })
      stream.probing = { controller, settled: probing.then(undefined, () => undefined) }
      const probed = await probing
      if (stream.probing?.controller === controller) delete stream.probing
      if (stream.closed || stream.failed) return
      if (!probed.ok) {
        logger.warn('live stream probe failed', {
          ...fields(stream),
          code: probed.error.code,
          ...(probed.error.context === undefined ? {} : { reason: probed.error.context }),
        })
        failAttempt(stream, 'probe_failed')
        return
      }
      probe = probed.value
      probeCache.recordProbe({ id: stream.channelId, probe, at: clock.now() })
    }
    stream.probe = probe
    stream.runs += 1
    const audio = liveAudioOf(probe)
    const handle = relay.start({
      channelId: stream.channelId,
      run: stream.runs,
      upstream: stream.upstream,
      videoCodec: probe.video.codec,
      ...(probe.transport === undefined ? {} : { transport: probe.transport }),
      ...(audio === undefined ? {} : { audio }),
    })
    launch(stream, handle, { audio: audio === undefined ? 'none' : audio.copy ? 'copy' : 'aac' })
  }

  const connectionsOf = (sourceId: string, channelId: string) =>
    [...streams.values()]
      .filter(
        (s) =>
          s.rendition === 'copy' &&
          s.sourceId === sourceId &&
          !s.failed &&
          s.channelId !== channelId,
      )
      .map((s) => ({
        channelId: s.channelId,
        viewers: s.viewers.size,
        ...(s.idleOrder === undefined ? {} : { idleOrder: s.idleOrder }),
      }))

  /** Removes a viewer; a stream left without any stops after the idle delay. */
  const leaveViewer = (stream: Stream, viewerId: string): void => {
    if (!stream.viewers.delete(viewerId) || stream.viewers.size > 0 || stream.closed) return
    if (stream.failed) {
      if (streams.get(stream.key) === stream) streams.delete(stream.key)
      return
    }
    idleCounter += 1
    stream.idleOrder = idleCounter
    stream.cancelIdle = timers.after(timings.idleStopMs, () => {
      delete stream.cancelIdle
      if (stream.viewers.size === 0) void stopStream(stream, 'idle')
    })
    // An idle compat stream lets its copy go idle too: both delays run together.
    releaseCopy(stream)
  }

  const newStream = (
    key: LiveStreamKey,
    sourceId: string,
    upstream: TvUpstream,
    existing: Stream | undefined,
  ): Stream => {
    const stream: Stream = existing ?? {
      key: keyOf(key),
      channelId: key.channelId,
      rendition: key.rendition,
      sourceId,
      upstream,
      host: upstreamHostOf(upstream.url),
      viewers: new Set(),
      failed: false,
      closed: false,
      runs: 0,
      failures: 0,
      window: [],
      expired: [],
      nextSequence: 0,
      overlongLogged: false,
      discontinuity: 0,
      runsOnDisk: new Set(),
      before: Promise.resolve(),
      listeners: new Set(),
      holdsCopy: false,
      holdsSlot: false,
    }
    stream.failed = false
    stream.failures = 0
    stream.upstream = upstream
    stream.host = upstreamHostOf(upstream.url)
    return stream
  }

  type JoinInput = {
    channel: { id: string; sourceId: string }
    upstream: TvUpstream
    maxConnections: number | undefined
  }

  /**
   * Adds a viewer to the channel's copy stream, starting it when it has none (or it failed):
   * the source's idle streams are stopped first when its connections are all in use.
   */
  const joinCopy = (
    viewerId: string,
    { channel, upstream, maxConnections }: JoinInput,
  ): Result<Stream, LiveConnectionError> => {
    const existing = streams.get(channel.id)
    if (existing !== undefined && !existing.failed) {
      keepWatched(existing, viewerId)
      return ok(existing)
    }
    const plan = planLiveConnection({
      connections: connectionsOf(channel.sourceId, channel.id),
      maxConnections,
      sourceId: channel.sourceId,
    })
    if (!plan.ok) {
      logger.info('live stream refused: connection limit', {
        channelId: channel.id,
        sourceId: channel.sourceId,
        code: plan.error.code,
      })
      return plan
    }
    for (const channelId of plan.value.evict) {
      const evicted = streams.get(channelId)
      if (evicted !== undefined) void stopStream(evicted, 'connection_limit')
    }
    const stream = newStream(
      { channelId: channel.id, rendition: 'copy' },
      channel.sourceId,
      upstream,
      existing,
    )
    // A channel never holds two connections, nor a source more than its limit: the first
    // attempt waits for every stop of the source under way (evicted streams, this channel's).
    stream.before = Promise.all(stopsOf(channel.sourceId))
    keepWatched(stream, viewerId)
    streams.set(stream.key, stream)
    logger.info('live stream starting', fields(stream))
    void attempt(stream)
    return ok(stream)
  }

  /**
   * Adds a viewer to the channel's compat stream, starting it when it has none (or it failed):
   * it takes a transcode slot, then joins the copy stream as its viewer.
   */
  const joinCompat = (viewerId: string, input: JoinInput): Result<void, LiveJoinError> => {
    const { channel } = input
    const key = keyOf({ channelId: channel.id, rendition: 'compat' })
    const existing = streams.get(key)
    if (existing !== undefined && !existing.failed) {
      keepWatched(existing, viewerId)
      return ok()
    }
    const holder = slotHolderOf(channel.id)
    // Idle (no viewer, in its idle delay), the stream gives its slot up to a new transcode.
    const slot = transcodeSlots.acquire(holder, {
      idleOrder: () => streams.get(key)?.idleOrder,
      evict: () => {
        const idle = streams.get(key)
        if (idle !== undefined) void stopStream(idle, 'transcode_limit')
      },
    })
    if (!slot.ok) {
      logger.info('live compat stream refused: transcode limit', {
        channelId: channel.id,
        code: slot.error.code,
      })
      return slot
    }
    const copy = joinCopy(compatViewerOf(channel.id), input)
    if (!copy.ok) {
      transcodeSlots.release(holder)
      return copy
    }
    const stream = newStream(
      { channelId: channel.id, rendition: 'compat' },
      channel.sourceId,
      input.upstream,
      existing,
    )
    stream.copy = copy.value
    stream.holdsCopy = true
    stream.holdsSlot = true
    // The channel's previous compat stream may still be stopping: its folder is this one's.
    stream.before = Promise.all(stopsOfKey(key))
    keepWatched(stream, viewerId)
    streams.set(key, stream)
    logger.info('live stream starting', fields(stream))
    void attempt(stream)
    return ok()
  }

  return {
    /**
     * Adds a viewer to the channel's stream of `rendition`, starting it when it has none (or it
     * failed). A compat stream needs a transcode slot and the copy stream (§29.4).
     */
    join: ({
      sessionId,
      rendition,
      ...input
    }: JoinInput & { sessionId: string; rendition: TvRendition }): Result<void, LiveJoinError> => {
      if (rendition === 'compat') return joinCompat(sessionId, input)
      const joined = joinCopy(sessionId, input)
      return joined.ok ? ok() : joined
    },

    /** Removes a viewer; a stream left without any stops after the idle delay. */
    leave: ({ sessionId, ...key }: LiveStreamKey & { sessionId: string }): void => {
      const stream = streams.get(keyOf(key))
      if (stream !== undefined) leaveViewer(stream, sessionId)
    },

    /**
     * Resolves once the stream lists its first segments (a player starts fed), fails, the wait
     * (counted from `since`, else now) times out, or `signal` aborts (the client gave up).
     */
    ready: (
      key: LiveStreamKey,
      { signal, since }: { signal?: AbortSignal; since?: Date } = {},
    ): Promise<Result<void, LiveStreamError>> => {
      const { channelId } = key
      const stream = streams.get(keyOf(key))
      if (stream === undefined) return Promise.resolve(unavailable(channelId, 'not_started'))
      return new Promise((resolve) => {
        const state = (): Result<void, LiveStreamError> | undefined => {
          if (signal?.aborted === true) return unavailable(channelId, 'aborted')
          const now = stateOf(stream)
          if (now === 'closed') return unavailable(channelId, 'stopped')
          if (now === 'failed') return unavailable(channelId, 'failed')
          return now === 'ready' ? ok() : undefined
        }
        const settled = state()
        if (settled !== undefined) {
          resolve(settled)
          return
        }
        const finish = (result: Result<void, LiveStreamError>) => {
          stream.listeners.delete(listener)
          signal?.removeEventListener('abort', listener)
          cancel()
          resolve(result)
        }
        const listener = () => {
          const now = state()
          if (now !== undefined) finish(now)
        }
        stream.listeners.add(listener)
        signal?.addEventListener('abort', listener, { once: true })
        const waited = since === undefined ? 0 : clock.now().getTime() - since.getTime()
        const cancel = timers.after(Math.max(0, timings.readyTimeoutMs - waited), () =>
          finish(unavailable(channelId, 'timeout')),
        )
      })
    },

    /**
     * The probe the channel's copy stream runs from: what chooses a rendition (§29.4), even when
     * the cached one was dropped meanwhile.
     */
    probeOf: (channelId: string): TvChannelProbe | undefined => {
      const copy = streams.get(keyOf({ channelId, rendition: 'copy' }))
      return copy === undefined || copy.failed || copy.closed ? undefined : copy.probe
    },

    /** Whether the stream is up (starting, running or retrying). */
    isAvailable: (key: LiveStreamKey): boolean => {
      const stream = streams.get(keyOf(key))
      return stream !== undefined && !stream.failed && !stream.closed
    },

    /**
     * The stream's playlist: its replay window (§29.4), from segment `from` on when asked (a
     * player that cannot seek in a live playlist loads one starting where it wants).
     */
    playlist: ({
      from,
      ...key
    }: LiveStreamKey & { from?: number }): Result<string, LiveStreamError> => {
      const stream = streams.get(keyOf(key))
      if (stream === undefined || stream.failed) return unavailable(key.channelId, 'not_running')
      const playlist =
        stream.targetS === undefined
          ? undefined
          : renderLivePlaylist(windowFrom(stream.window, from), stream.targetS)
      return playlist === undefined ? unavailable(key.channelId, 'not_ready') : ok(playlist)
    },

    /** The replay window's length now (§29.4), told to each new session. */
    windowS: (): number => limits().windowS,

    file: ({ name, ...key }: LiveStreamKey & { name: string }): Result<string, LiveFileError> => {
      const stream = streams.get(keyOf(key))
      if (stream === undefined || stream.failed) return unavailable(key.channelId, 'not_running')
      const path = isLiveFileName(name) ? relay.fileOf({ ...key, name }) : undefined
      return path === undefined
        ? err(
            appError('tv/segment_not_found', 'no such live segment', {
              context: { channelId: key.channelId, name },
            }),
          )
        : ok(path)
    },

    /** The streams now: tests and diagnostics. */
    snapshot: () =>
      [...streams.values()].map((stream) => ({
        channelId: stream.channelId,
        rendition: stream.rendition,
        sourceId: stream.sourceId,
        viewers: stream.viewers.size,
        failed: stream.failed,
        runs: stream.runs,
        segments: stream.window.length,
        windowS: stream.window.reduce((sum, segment) => sum + segment.durationS, 0),
        expired: stream.expired.length,
      })),

    /** Stops every stream (shutdown) and waits for their processes, ffprobe included. */
    stopAll: async (): Promise<void> => {
      for (const stream of [...streams.values()]) void stopStream(stream, 'shutdown')
      await Promise.all([...stopping].map((stop) => stop.done))
    },
  }
}

export type LiveStreams = ReturnType<typeof liveStreamsFactory>
