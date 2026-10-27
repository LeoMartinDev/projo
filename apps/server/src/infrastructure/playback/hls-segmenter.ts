import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'

import { appError, err, ok, type Result } from '@projo/shared'

import {
  initSegmentName,
  nearestKeyframe,
  segmentAt,
  segmentFileName,
} from '../../core/playback/hls-playlist.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import type {
  HlsJob,
  HlsSegmenter,
  SegmentError,
  TranscodeCache,
  TranscodeCacheEntry,
  TranscodeCacheInventory,
} from '../../core/playback/ports.ts'
import {
  type FfmpegFilters,
  outputTimestampOffsetS,
  remuxArgs,
  tonemaps,
  transcodeArgs,
} from './ffmpeg-args.ts'
import {
  createBoxSplitter,
  fragmentStartTicks,
  readTracks,
  setSequenceNumber,
  type TrackInfo,
} from './fmp4.ts'

type Deps = {
  /** `/data/cache/transcode`: one folder per session. */
  transcodeDir: string
  logger: Logger
  ffmpegBinary?: string
  /** Optional filters of the binary (HDR tonemapping); detected on the first transcode if absent. */
  filters?: FfmpegFilters
  /** §10.3 `hw_accel = vaapi`: the render node the container was given. */
  renderNode?: string
  /** `playback/hw_accel_failed`, resolved by the next working VAAPI run. */
  notifier?: AdminNotifier
  /** §10.3: a segment not yet written is awaited this long before 503. */
  waitTimeoutMs?: number
  /** §10.3 production window: a request beyond `current + windowAhead` restarts ffmpeg. */
  windowAhead?: number
  /** ffmpeg is paused (stdout no longer read) this many segments ahead of the last request. */
  bufferAhead?: number
  /** Segments older than this behind the last request are deleted while playing. */
  keepBehind?: number
  /** Ids of stopped sessions remembered (oldest forgotten first) so a late request is refused. */
  rememberStopped?: number
}

type Run = {
  /** Unique per segmenter: names the run's temporary files. */
  id: number
  proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  fromSegment: number
  /** Segment being accumulated (or about to be). */
  producing: number
  killed: boolean
  finished: boolean
  failed: boolean
  /** ffmpeg reached the end of the file (exit 0, not killed): nothing after `producing` will come. */
  endedCleanly: boolean
  resume: (() => void) | undefined
  vaapi: boolean
  /** A VAAPI run that failed before writing anything: the session goes on in software. */
  fallback: boolean
}

type SessionState = {
  job: HlsJob
  dir: string
  run: Run | undefined
  lastRequested: number
  listeners: Set<() => void>
  /** Set by `stop`: pending requests give up instead of restarting ffmpeg. */
  stopped: boolean
  /** Decided by the session's first run (`wantsVaapi` + render node); off after a fallback. */
  vaapi: boolean | undefined
}

/** Segment being written box by box to `temp` (§21); no sink for an incomplete segment. */
type Pending = { segment: number; temp: string; sink: Bun.FileSink | undefined }

/** `ffmpeg -filters`: is `name` listed? */
const hasFilter = (listing: string, name: string): boolean =>
  new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(listing)

export const detectFfmpegFilters = (ffmpegBinary = 'ffmpeg'): FfmpegFilters => {
  try {
    const listing = Bun.spawnSync([ffmpegBinary, '-hide_banner', '-filters'], {
      stdout: 'pipe',
      stderr: 'ignore',
    }).stdout.toString()
    return { zscale: hasFilter(listing, 'zscale'), tonemap: hasFilter(listing, 'tonemap') }
  } catch {
    return { zscale: false, tonemap: false }
  }
}

/** §10.3: VAAPI is only tried for a transcode without burn-in, when the admin turned it on. */
export const wantsVaapi = (job: HlsJob): boolean =>
  job.mode === 'hls_transcode' && job.hwAccel === 'vaapi' && job.transcode.burnIn === undefined

/**
 * §10.3 fallback: a failed VAAPI run that wrote no `init.mp4` (device, driver or codec refused at
 * start) is retried in software; once an init exists, the session's encoder cannot change.
 */
export const fallsBackToSoftware = (run: {
  vaapi: boolean
  exitCode: number
  killed: boolean
  initExists: boolean
}): boolean => run.vaapi && !run.killed && run.exitCode !== 0 && !run.initExists

const usable = (path: string): boolean => {
  try {
    accessSync(path, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Where a fragment starting at `time` goes, and its `mfhd` number (stable across runs). */
const placeFragment = (
  job: HlsJob,
  time: number,
): { segment: number; sequence: number; complete: boolean } => {
  if (job.mode === 'hls_transcode') {
    // A run starts on a segment start and the encoder only cuts there: always complete.
    const segment = segmentAt(job.segments, time)
    return { segment, sequence: segment + 1, complete: true }
  }
  const keyframe = nearestKeyframe(job.keyframes, time)
  const keyframeTime = job.keyframes[keyframe] ?? time
  const segment = segmentAt(job.segments, keyframeTime)
  const segmentStart = job.segments[segment]?.startS ?? 0
  // Complete only if no earlier keyframe of this segment was missed (imprecise seek).
  const previousKeyframe = job.keyframes[keyframe - 1]
  const complete =
    keyframe === 0 || previousKeyframe === undefined || previousKeyframe < segmentStart - 1e-3
  return { segment, sequence: keyframe + 1, complete }
}

/**
 * §10.3 HLS producer (remux and transcode). One ffmpeg per session writes a fragmented MP4 (a
 * fragment per video keyframe) on stdout; fragments are placed by their `tfdt` (remux: matched
 * to the source keyframes; transcode: one forced keyframe per 4 s segment) and grouped into the
 * planned segments (`seg-%05d.m4s`), the `ftyp`+`moov` head becomes `init.mp4`. Reading stdout is
 * paused when production runs too far ahead of the player: the pipe applies back-pressure.
 */
export const createHlsSegmenter = ({
  transcodeDir,
  logger,
  ffmpegBinary = 'ffmpeg',
  waitTimeoutMs = 20_000,
  windowAhead = 3,
  bufferAhead = 8,
  keepBehind = 40,
  rememberStopped = 10_000,
  filters,
  renderNode = '/dev/dri/renderD128',
  notifier,
}: Deps): HlsSegmenter => {
  let knownFilters = filters
  const ffmpegFilters = (): FfmpegFilters => {
    knownFilters ??= detectFfmpegFilters(ffmpegBinary)
    return knownFilters
  }
  const sessions = new Map<string, SessionState>()
  let runCount = 0
  /** Insertion-ordered: a request in flight when its session stopped must not revive it. */
  const stoppedIds = new Set<string>()
  const markStopped = (sessionId: string): void => {
    stoppedIds.delete(sessionId)
    stoppedIds.add(sessionId)
    for (const oldest of stoppedIds) {
      if (stoppedIds.size <= rememberStopped) break
      stoppedIds.delete(oldest)
    }
  }

  const fileFor = (state: SessionState, which: number | 'init'): string =>
    join(state.dir, which === 'init' ? initSegmentName : segmentFileName(which))

  const wakeAll = (state: SessionState): void => {
    for (const listener of [...state.listeners]) listener()
  }

  const waitForChange = (state: SessionState, ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        state.listeners.delete(done)
        signal?.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      state.listeners.add(done)
      signal?.addEventListener('abort', done, { once: true })
    })

  const writeAtomically = async (path: string, parts: Uint8Array[]): Promise<void> => {
    const temporary = `${path}.tmp`
    await Bun.write(temporary, new Blob(parts))
    await rename(temporary, path)
  }

  const stopRun = (state: SessionState): void => {
    const run = state.run
    state.run = undefined
    if (run === undefined || run.finished) return
    run.killed = true
    run.proc.kill('SIGKILL')
    run.resume?.()
  }

  const openSegment = (
    state: SessionState,
    run: Run,
    segment: number,
    complete: boolean,
  ): Pending => {
    // Per run: a killed run still closing its file must not share it with the next one.
    const temp = `${fileFor(state, segment)}.${run.id}.tmp`
    return { segment, temp, sink: complete ? Bun.file(temp).writer() : undefined }
  }

  const append = async (pending: Pending | undefined, bytes: Uint8Array): Promise<void> => {
    if (pending?.sink === undefined) return
    pending.sink.write(bytes)
    await pending.sink.flush()
  }

  /** A killed or failed run: its unfinished segment never becomes visible. */
  const discard = async (pending: Pending | undefined): Promise<void> => {
    if (pending === undefined) return
    try {
      await pending.sink?.end()
      rmSync(pending.temp, { force: true })
    } catch {
      // The session folder may already be gone (cache removal).
    }
  }

  const finalize = async (state: SessionState, pending: Pending): Promise<void> => {
    const sink = pending.sink
    if (sink === undefined) return
    pending.sink = undefined
    await sink.end()
    const path = fileFor(state, pending.segment)
    if (existsSync(path)) unlinkSync(pending.temp)
    else await rename(pending.temp, path)
    const old = state.lastRequested - keepBehind
    if (old >= 0 && old < pending.segment && existsSync(fileFor(state, old))) {
      unlinkSync(fileFor(state, old))
    }
    wakeAll(state)
  }

  const consume = async (state: SessionState, run: Run): Promise<void> => {
    const { job } = state
    const stderr = new Response(run.proc.stderr).text()
    const reader = run.proc.stdout.getReader()
    const splitter = createBoxSplitter()
    const head: Uint8Array[] = []
    let video: TrackInfo | undefined
    let current: Pending | undefined
    let skipping = false
    try {
      for (;;) {
        while (!run.killed && run.producing > state.lastRequested + bufferAhead) {
          await new Promise<void>((resolve) => (run.resume = resolve))
          run.resume = undefined
        }
        if (run.killed) break
        const { value, done } = await reader.read()
        if (done || run.killed) break
        for (const box of splitter.push(value)) {
          if (box.type === 'moof') {
            if (video === undefined) throw new Error('fragment before moov')
            const ticks = fragmentStartTicks(box.bytes, video.trackId)
            if (ticks === undefined) {
              // A fragment without video: continuation of the current segment.
              if (!skipping) await append(current, box.bytes)
              continue
            }
            const time = ticks / video.timescale - outputTimestampOffsetS
            const { segment, sequence, complete } = placeFragment(job, time)
            setSequenceNumber(box.bytes, sequence)
            if (segment < run.fromSegment) {
              skipping = true
              continue
            }
            if (current === undefined || segment !== current.segment) {
              if (current !== undefined) await finalize(state, current)
              current = openSegment(state, run, segment, complete)
              run.producing = segment
            }
            await append(current, box.bytes)
            skipping = false
          } else if (box.type === 'mdat') {
            if (!skipping) await append(current, box.bytes)
          } else if (video === undefined) {
            head.push(box.bytes)
            if (box.type === 'moov') {
              video = readTracks(box.bytes).find((track) => track.handler === 'vide')
              if (video === undefined) throw new Error('no video track in moov')
              const init = fileFor(state, 'init')
              if (!existsSync(init)) await writeAtomically(init, head)
              if (run.vaapi) notifier?.resolve({ kind: 'playback/hw_accel_failed', key: 'vaapi' })
              wakeAll(state)
            }
          }
          // Anything after the fragments (mfra trailer) is ignored.
        }
      }
      const code = await run.proc.exited
      if (!run.killed && code === 0) {
        if (current !== undefined) await finalize(state, current)
        run.endedCleanly = true
      }
      const initExists = existsSync(fileFor(state, 'init'))
      if (fallsBackToSoftware({ ...run, exitCode: code, initExists })) {
        run.failed = true
        run.fallback = true
        state.vaapi = false
        vaapiFailed(job, 'ffmpeg_failed', (await stderr).slice(-2000))
      } else if (!run.killed && code !== 0) {
        run.failed = true
        logger.error('ffmpeg HLS run failed', {
          code: 'playback/stream_failed',
          sessionId: job.sessionId,
          exitCode: code,
          stderr: (await stderr).slice(-2000),
        })
      }
    } catch (cause) {
      if (!run.killed) {
        run.failed = true
        run.proc.kill('SIGKILL')
        logger.error('HLS stream unreadable', {
          code: 'playback/stream_failed',
          sessionId: job.sessionId,
          error: cause,
        })
      }
    } finally {
      run.finished = true
      reader.releaseLock()
      wakeAll(state)
      await discard(current)
    }
  }

  const vaapiFailed = (
    job: HlsJob,
    reason: 'render_node_unavailable' | 'ffmpeg_failed',
    stderr?: string,
  ): void => {
    logger.warn('VAAPI unavailable, transcoding in software', {
      code: 'playback/hw_accel_failed',
      sessionId: job.sessionId,
      reason,
      renderNode,
      ...(stderr === undefined ? {} : { stderr }),
    })
    notifier?.notify({
      kind: 'playback/hw_accel_failed',
      severity: 'warning',
      key: 'vaapi',
      context: { reason, renderNode, codec: job.video.codec },
    })
  }

  const argsFor = (job: HlsJob, startS: number, vaapi: boolean): string[] => {
    const common = {
      sourcePath: job.sourcePath,
      startS,
      audioDownmix: job.audioDownmix,
      ...(job.audio === undefined ? {} : { audio: job.audio }),
    }
    if (job.mode === 'hls_remux') return remuxArgs({ ...common, video: job.video })
    const { quality, dynamicRange, burnIn } = job.transcode
    return transcodeArgs({
      ...common,
      video: { ...job.video, ...(dynamicRange === undefined ? {} : { dynamicRange }) },
      quality,
      ...(burnIn === undefined ? {} : { burnIn }),
      filters: ffmpegFilters(),
      ...(vaapi ? { vaapiDevice: renderNode } : {}),
    })
  }

  const startRun = (state: SessionState, fromSegment: number): Run | undefined => {
    stopRun(state)
    const { job } = state
    if (state.vaapi === undefined) {
      state.vaapi = wantsVaapi(job) && usable(renderNode)
      if (wantsVaapi(job) && !state.vaapi) vaapiFailed(job, 'render_node_unavailable')
    }
    const vaapi = state.vaapi
    try {
      mkdirSync(state.dir, { recursive: true })
      const proc = Bun.spawn({
        cmd: [ffmpegBinary, ...argsFor(job, job.segments[fromSegment]?.startS ?? 0, vaapi)],
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      runCount += 1
      const run: Run = {
        id: runCount,
        proc,
        fromSegment,
        producing: fromSegment,
        killed: false,
        finished: false,
        failed: false,
        endedCleanly: false,
        resume: undefined,
        vaapi,
        fallback: false,
      }
      state.run = run
      logger.debug('ffmpeg HLS run started', {
        sessionId: job.sessionId,
        mode: job.mode,
        fromSegment,
        vaapi,
      })
      if (job.mode === 'hls_transcode' && (job.transcode.dynamicRange ?? 'sdr') !== 'sdr') {
        // §10.3: CPU tone mapping is the costliest transcode; the admin sees why the CPU is busy.
        logger.info('HDR source transcoded to SDR', {
          code: 'playback/hdr_tonemap',
          sessionId: job.sessionId,
          tonemapped: tonemaps(job.transcode, ffmpegFilters()),
        })
      }
      void consume(state, run)
      return run
    } catch (cause) {
      logger.error('cannot start ffmpeg', {
        code: 'playback/stream_failed',
        sessionId: job.sessionId,
        error: cause,
      })
      return undefined
    }
  }

  const stateFor = (job: HlsJob): SessionState | undefined => {
    if (stoppedIds.has(job.sessionId)) return undefined
    const existing = sessions.get(job.sessionId)
    if (existing !== undefined) {
      existing.job = job
      return existing
    }
    const state: SessionState = {
      job,
      dir: join(transcodeDir, job.sessionId),
      run: undefined,
      lastRequested: -1,
      listeners: new Set(),
      stopped: false,
      vaapi: undefined,
    }
    sessions.set(job.sessionId, state)
    return state
  }

  const failed = (message: string, context: Record<string, unknown>): SegmentError =>
    appError('playback/stream_failed', message, { context })

  const neverProduced = (job: HlsJob, which: number | 'init'): SegmentError =>
    appError('playback/segment_not_found', 'ffmpeg ended without producing the segment', {
      context: { sessionId: job.sessionId, segment: which },
    })

  return {
    /**
     * Waits for `which` only while the live run will produce it (at or after the segment being
     * accumulated, within the window); otherwise restarts ffmpeg there, but only for the latest
     * segment asked for (an older request still waiting must not take the run back from it). A
     * run that ends without writing `which` (a tail with no video frame) is an error, never a
     * restart; a request whose client went away (`signal`) gives up.
     */
    segment: async (job, which, signal): Promise<Result<string, SegmentError>> => {
      if (which !== 'init' && (which < 0 || which >= job.segments.length)) {
        return err(
          appError('playback/segment_not_found', 'no such segment', {
            context: { sessionId: job.sessionId, segment: which },
          }),
        )
      }
      const state = stateFor(job)
      if (state === undefined) {
        return err(failed('playback session stopped', { sessionId: job.sessionId }))
      }
      const target = fileFor(state, which)
      if (which !== 'init') {
        state.lastRequested = which
        state.run?.resume?.()
      }
      const deadline = Date.now() + waitTimeoutMs
      let started: Run | undefined
      for (;;) {
        if (existsSync(target)) return ok(target)
        if (state.stopped) {
          return err(failed('playback session stopped', { sessionId: job.sessionId }))
        }
        if (signal?.aborted === true) {
          return err(
            appError('playback/segment_timeout', 'segment request aborted', {
              context: { sessionId: job.sessionId, segment: which },
            }),
          )
        }
        // Retried in software below, like a run that ended without the segment.
        if (started?.fallback === true) started = undefined
        if (started !== undefined && started.finished && !started.killed) {
          return err(
            started.failed
              ? failed('ffmpeg failed', { sessionId: job.sessionId, segment: which })
              : neverProduced(job, which),
          )
        }
        const run = state.run
        // The run read the file to its end without writing `which` (its last segment, finalized
        // last, cannot have been deleted since): no run ever will.
        if (which !== 'init' && run?.endedCleanly === true && which >= run.producing) {
          return err(neverProduced(job, which))
        }
        const inWindow =
          run !== undefined &&
          !run.finished &&
          (which === 'init' || (which >= run.producing && which <= run.producing + windowAhead))
        const mayRestart =
          which === 'init' ? run === undefined || run.finished : which === state.lastRequested
        if (!inWindow && mayRestart) {
          // hls.js asks for init first: start where it resumes, not at 0 (a run it would kill);
          // counted as requested, or the run would pause ahead of the player before its moov.
          if (which === 'init' && state.lastRequested < 0) {
            state.lastRequested = segmentAt(job.segments, job.startS ?? 0)
          }
          started = startRun(state, which === 'init' ? state.lastRequested : which)
          if (started === undefined) {
            return err(failed('cannot start ffmpeg', { sessionId: job.sessionId }))
          }
        }
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          return err(
            appError('playback/segment_timeout', 'segment not ready in time', {
              context: { sessionId: job.sessionId, segment: which },
            }),
          )
        }
        await waitForChange(state, remaining, signal)
      }
    },

    stop: (sessionId) => {
      markStopped(sessionId)
      const state = sessions.get(sessionId)
      if (state === undefined) return
      state.stopped = true
      stopRun(state)
      sessions.delete(sessionId)
      wakeAll(state)
    },

    sessionIds: () => [...sessions.keys()],

    stopAll: async () => {
      const exits: Promise<unknown>[] = []
      for (const [sessionId, state] of sessions) {
        markStopped(sessionId)
        if (state.run !== undefined) exits.push(state.run.proc.exited)
        state.stopped = true
        stopRun(state)
        wakeAll(state)
      }
      sessions.clear()
      await Promise.all(exits)
    },
  }
}

/** Bytes of the files of a folder and its subfolders (vanishing files count 0). */
const folderSize = (dir: string): number => {
  try {
    return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return total + folderSize(path)
      try {
        return total + statSync(path).size
      } catch {
        return total
      }
    }, 0)
  } catch {
    return 0
  }
}

/** `/data/cache/transcode/<session>` folders (§5.4). */
export const createTranscodeCache = ({
  transcodeDir,
}: {
  transcodeDir: string
}): TranscodeCache & TranscodeCacheInventory => {
  const listSessionIds = (): string[] => {
    try {
      return readdirSync(transcodeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  }
  return {
    listSessionIds,
    entries: (): TranscodeCacheEntry[] =>
      listSessionIds().map((sessionId) => ({
        sessionId,
        sizeBytes: folderSize(join(transcodeDir, sessionId)),
      })),
    remove: (sessionId: string): void => {
      if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return
      rmSync(join(transcodeDir, sessionId), { recursive: true, force: true })
    },
  }
}
