import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvUpstream } from '../../core/tv/channel.ts'
import { type LiveConnectionError, planLiveConnection } from '../../core/tv/live-connections.ts'
import {
  liveTargetDurationOf,
  type LiveWindowSegment,
  renderLivePlaylist,
  servedWindow,
} from '../../core/tv/live-playlist.ts'
import {
  isLiveFileName,
  liveAudioOf,
  type LiveProbeCache,
  type LiveProber,
  type LiveRelay,
  type LiveRun,
  type LiveSegmentFile,
  type LiveTimers,
  liveTimings,
  upstreamHostOf,
} from '../../core/tv/live.ts'

export type LiveStreamError = AppError<'tv/stream_unavailable'>
export type LiveFileError = AppError<'tv/stream_unavailable' | 'tv/segment_not_found'>

type Timings = {
  pollMs: number
  stallMs: number
  idleStopMs: number
  retryDelaysMs: readonly number[]
  readyTimeoutMs: number
  readySegments: number
  windowS: number
}

type Deps = {
  relay: LiveRelay
  prober: LiveProber
  probeCache: LiveProbeCache
  timers: LiveTimers
  clock: Clock
  logger: Logger
  timings?: Partial<Timings>
}

type ActiveRun = {
  number: number
  handle: LiveRun
  /** Index of the last segment appended from this run. */
  lastIndex: number
  sawSegment: boolean
  quietPolls: number
  /** Stopped on purpose (idle, eviction, shutdown): its exit is no failure. */
  stopping: boolean
}

type Stream = {
  channelId: string
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
  window: LiveWindowSegment[]
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
  /** Stops to wait for before the next attempt: every stop of the source under way. */
  before: Promise<unknown>
  cancelPoll?: () => void
  cancelIdle?: () => void
  cancelRetry?: () => void
  listeners: Set<() => void>
}

const segmentIndexOf = (name: string): number => {
  const index = /-(\d+)\.m4s$/u.exec(name)?.[1]
  return index === undefined ? -1 : Number(index)
}

const unavailable = (channelId: string, reason: string): Result<never, LiveStreamError> =>
  err(
    appError('tv/stream_unavailable', 'the channel stream is unavailable', {
      context: { channelId, reason },
    }),
  )

/**
 * The channel streams (§29.4): one ffmpeg run at a time per channel, shared by its viewers,
 * probed, restarted after a failure, stopped once idle, within its source's connection limit.
 * Holds every stream in memory, with its timers.
 */
export const liveStreamsFactory = ({
  relay,
  prober,
  probeCache,
  timers,
  clock,
  logger,
  timings: overrides = {},
}: Deps) => {
  const timings: Timings = { ...liveTimings, ...overrides }
  const streams = new Map<string, Stream>()
  /** Stops under way: their ffmpeg or ffprobe may still hold an upstream connection. */
  const stopping = new Set<{ sourceId: string; done: Promise<void> }>()
  let idleCounter = 0

  const notify = (stream: Stream): void => {
    for (const listener of [...stream.listeners]) listener()
  }

  const fields = (stream: Stream) => ({ channelId: stream.channelId, upstream: stream.host })

  const cancelTimers = (stream: Stream): void => {
    stream.cancelPoll?.()
    stream.cancelIdle?.()
    stream.cancelRetry?.()
    delete stream.cancelPoll
    delete stream.cancelIdle
    delete stream.cancelRetry
  }

  const stopsOf = (sourceId: string): Promise<void>[] =>
    [...stopping].filter((stop) => stop.sourceId === sourceId).map((stop) => stop.done)

  /**
   * Stops a stream: its run killed or its probe aborted, then its folder deleted. Settles once
   * neither process holds the upstream any more.
   */
  const stopStream = (stream: Stream, reason: string): Promise<void> => {
    if (streams.get(stream.channelId) === stream) streams.delete(stream.channelId)
    if (stream.closed) return Promise.all(stopsOf(stream.sourceId)).then(() => {})
    stream.closed = true
    cancelTimers(stream)
    notify(stream)
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
      relay.removeStream(stream.channelId)
    })()
    const entry = { sourceId: stream.sourceId, done }
    stopping.add(entry)
    void done.then(() => stopping.delete(entry))
    logger.info('live stream stopped', { ...fields(stream), reason })
    return done
  }

  const markFailed = (stream: Stream): void => {
    stream.failed = true
    cancelTimers(stream)
    stream.window = []
    stream.runsOnDisk.clear()
    relay.removeStream(stream.channelId)
    logger.warn('live stream unavailable', {
      ...fields(stream),
      code: 'tv/stream_unavailable',
      attempts: stream.failures,
    })
    notify(stream)
    if (stream.viewers.size === 0 && streams.get(stream.channelId) === stream) {
      streams.delete(stream.channelId)
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

  const append = (stream: Stream, run: number, segment: LiveSegmentFile): void => {
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
    })
    stream.nextSequence += 1
  }

  /** Slides the window; the files of an earlier run go once none of its segments is left. */
  const slide = (stream: Stream): void => {
    stream.window = servedWindow(stream.window, timings.windowS)
    const kept = new Set(stream.window.map((segment) => segment.run))
    for (const run of [...stream.runsOnDisk]) {
      if (run === stream.run?.number || kept.has(run)) continue
      stream.runsOnDisk.delete(run)
      relay.removeRun({ channelId: stream.channelId, run })
    }
  }

  const poll = (stream: Stream, run: ActiveRun): void => {
    delete stream.cancelPoll
    if (stream.closed || stream.failed || stream.run !== run || run.stopping) return
    const fresh = relay
      .segmentsOf({ channelId: stream.channelId, run: run.number })
      .filter(
        (segment) => isLiveFileName(segment.name) && segmentIndexOf(segment.name) > run.lastIndex,
      )
    if (fresh.length > 0) {
      const wasReady = stream.window.length >= timings.readySegments
      for (const segment of fresh) append(stream, run.number, segment)
      run.lastIndex = segmentIndexOf(fresh.at(-1)?.name ?? '')
      run.quietPolls = 0
      run.sawSegment = true
      stream.failures = 0
      slide(stream)
      if (!wasReady && stream.window.length >= timings.readySegments) {
        logger.info('live stream ready', fields(stream))
      }
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
    // A run that listed nothing may have been started from a stale probe: probe again.
    if (!run.sawSegment) probeCache.recordProbe({ id: stream.channelId, at: clock.now() })
    failAttempt(stream, 'run_ended')
  }

  const attempt = async (stream: Stream): Promise<void> => {
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
    const run: ActiveRun = {
      number: stream.runs,
      handle,
      lastIndex: -1,
      sawSegment: false,
      quietPolls: 0,
      stopping: false,
    }
    stream.run = run
    stream.runsOnDisk.add(run.number)
    logger.info('live stream run started', {
      ...fields(stream),
      run: run.number,
      audio: audio === undefined ? 'none' : audio.copy ? 'copy' : 'aac',
    })
    stream.cancelPoll = timers.after(timings.pollMs, () => poll(stream, run))
    void handle.exited.then((exit) => onExit(stream, run, exit))
  }

  const connectionsOf = (sourceId: string, channelId: string) =>
    [...streams.values()]
      .filter((s) => s.sourceId === sourceId && !s.failed && s.channelId !== channelId)
      .map((s) => ({
        channelId: s.channelId,
        viewers: s.viewers.size,
        ...(s.idleOrder === undefined ? {} : { idleOrder: s.idleOrder }),
      }))

  const keepWatched = (stream: Stream, sessionId: string): void => {
    stream.viewers.add(sessionId)
    stream.cancelIdle?.()
    delete stream.cancelIdle
    delete stream.idleOrder
  }

  return {
    /**
     * Adds a viewer to the channel's stream, starting it when it has none (or it failed): the
     * source's idle streams are stopped first when its connections are all in use.
     */
    join: ({
      sessionId,
      channel,
      upstream,
      maxConnections,
    }: {
      sessionId: string
      channel: { id: string; sourceId: string }
      upstream: TvUpstream
      maxConnections: number | undefined
    }): Result<void, LiveConnectionError> => {
      const existing = streams.get(channel.id)
      if (existing !== undefined && !existing.failed) {
        keepWatched(existing, sessionId)
        return ok()
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
      const stream: Stream = existing ?? {
        channelId: channel.id,
        sourceId: channel.sourceId,
        upstream,
        host: upstreamHostOf(upstream.url),
        viewers: new Set(),
        failed: false,
        closed: false,
        runs: 0,
        failures: 0,
        window: [],
        nextSequence: 0,
        overlongLogged: false,
        discontinuity: 0,
        runsOnDisk: new Set(),
        before: Promise.resolve(),
        listeners: new Set(),
      }
      stream.failed = false
      stream.failures = 0
      stream.upstream = upstream
      stream.host = upstreamHostOf(upstream.url)
      // A channel never holds two connections, nor a source more than its limit: the first
      // attempt waits for every stop of the source under way (evicted streams, this channel's).
      stream.before = Promise.all(stopsOf(channel.sourceId))
      keepWatched(stream, sessionId)
      streams.set(channel.id, stream)
      logger.info('live stream starting', fields(stream))
      void attempt(stream)
      return ok()
    },

    /** Removes a viewer; a stream left without any stops after the idle delay. */
    leave: ({ sessionId, channelId }: { sessionId: string; channelId: string }): void => {
      const stream = streams.get(channelId)
      if (stream === undefined || !stream.viewers.delete(sessionId)) return
      if (stream.viewers.size > 0) return
      if (stream.failed) {
        streams.delete(channelId)
        return
      }
      idleCounter += 1
      stream.idleOrder = idleCounter
      stream.cancelIdle = timers.after(timings.idleStopMs, () => {
        delete stream.cancelIdle
        if (stream.viewers.size === 0) void stopStream(stream, 'idle')
      })
    },

    /**
     * Resolves once the channel's stream lists its first segments (a player starts fed), fails,
     * the wait times out, or `signal` aborts (the client gave up).
     */
    ready: (channelId: string, signal?: AbortSignal): Promise<Result<void, LiveStreamError>> => {
      const stream = streams.get(channelId)
      if (stream === undefined) return Promise.resolve(unavailable(channelId, 'not_started'))
      return new Promise((resolve) => {
        const state = (): Result<void, LiveStreamError> | undefined => {
          if (signal?.aborted === true) return unavailable(channelId, 'aborted')
          if (stream.closed) return unavailable(channelId, 'stopped')
          if (stream.failed) return unavailable(channelId, 'failed')
          return stream.window.length >= timings.readySegments ? ok() : undefined
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
        const cancel = timers.after(timings.readyTimeoutMs, () =>
          finish(unavailable(channelId, 'timeout')),
        )
      })
    },

    /** Whether the channel's stream is up (starting, running or retrying). */
    isAvailable: (channelId: string): boolean => {
      const stream = streams.get(channelId)
      return stream !== undefined && !stream.failed && !stream.closed
    },

    playlist: (channelId: string): Result<string, LiveStreamError> => {
      const stream = streams.get(channelId)
      if (stream === undefined || stream.failed) return unavailable(channelId, 'not_running')
      const playlist =
        stream.targetS === undefined
          ? undefined
          : renderLivePlaylist(servedWindow(stream.window, timings.windowS), stream.targetS)
      return playlist === undefined ? unavailable(channelId, 'not_ready') : ok(playlist)
    },

    file: ({
      channelId,
      name,
    }: {
      channelId: string
      name: string
    }): Result<string, LiveFileError> => {
      const stream = streams.get(channelId)
      if (stream === undefined || stream.failed) return unavailable(channelId, 'not_running')
      const path = isLiveFileName(name) ? relay.fileOf({ channelId, name }) : undefined
      return path === undefined
        ? err(
            appError('tv/segment_not_found', 'no such live segment', {
              context: { channelId, name },
            }),
          )
        : ok(path)
    },

    /** The streams now: tests and diagnostics. */
    snapshot: () =>
      [...streams.values()].map((stream) => ({
        channelId: stream.channelId,
        sourceId: stream.sourceId,
        viewers: stream.viewers.size,
        failed: stream.failed,
        runs: stream.runs,
        segments: stream.window.length,
      })),

    /** Stops every stream (shutdown) and waits for their processes, ffprobe included. */
    stopAll: async (): Promise<void> => {
      for (const stream of [...streams.values()]) void stopStream(stream, 'shutdown')
      await Promise.all([...stopping].map((stop) => stop.done))
    },
  }
}

export type LiveStreams = ReturnType<typeof liveStreamsFactory>
