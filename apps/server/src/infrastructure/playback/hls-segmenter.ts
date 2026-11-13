import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import {
  initSegmentName,
  nearestKeyframe,
  segmentAt,
  segmentFileName,
} from '../../core/playback/hls-playlist.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
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
  type X264Preset,
} from './ffmpeg-args.ts'
import {
  createBoxSplitter,
  fragmentStartTicks,
  readTracks,
  setSequenceNumber,
  type TrackInfo,
} from './fmp4.ts'

type Deps = {
  transcodeDir: string
  logger: Logger
  ffmpegBinary?: string
  filters?: FfmpegFilters
  renderNode?: string
  notifier?: AdminNotifier
  waitTimeoutMs?: number
  windowAhead?: number
  bufferAhead?: number
  keepBehind?: number
  rememberStopped?: number
  presetsFile?: string
}

type Run = {
  id: number
  proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>
  fromSegment: number
  producing: number
  killed: boolean
  finished: boolean
  failed: boolean
  endedCleanly: boolean
  resume: (() => void) | undefined
  vaapi: boolean
  fallback: boolean
  throttled: boolean
  speed: SpeedSample | undefined
}

type SpeedSample = { preset: X264Preset; fromS: number | undefined; at: number; done: boolean }

type SessionState = {
  job: HlsJob
  dir: string
  run: Run | undefined
  lastRequested: number
  listeners: Set<() => void>
  stopped: boolean
  vaapi: boolean | undefined
  preset: X264Preset | undefined
}

const speedSampleS = 12

export const nextPreset = (current: X264Preset, speed: number): X264Preset => {
  if (current === 'veryfast' && speed < 1.25) return 'ultrafast'
  if (current === 'ultrafast' && speed > 3) return 'veryfast'
  return current
}

export const presetKey = (job: HlsJob): string => {
  if (job.mode !== 'hls_transcode') return job.mode
  const { quality, dynamicRange, burnIn } = job.transcode
  return [
    job.video.codec,
    job.video.pixelFormat ?? 'unknown',
    job.video.height ?? 0,
    quality,
    dynamicRange ?? 'sdr',
    burnIn === undefined ? 'plain' : 'burn_in',
  ].join(':')
}

const presetsSchema = z.record(z.string(), z.enum(['veryfast', 'ultrafast']))

const loadPresets = (path: string): Map<string, X264Preset> => {
  try {
    const parsed = presetsSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    return new Map(parsed.success ? Object.entries(parsed.data) : [])
  } catch {
    return new Map()
  }
}

const savePresets = (path: string, presets: Map<string, X264Preset>): void => {
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(Object.fromEntries(presets)))
  } catch {}
}

type Pending = { segment: number; temp: string; sink: Bun.FileSink | undefined }

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

export const wantsVaapi = (job: HlsJob): boolean =>
  job.mode === 'hls_transcode' && job.hwAccel === 'vaapi' && job.transcode.burnIn === undefined

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

const forcedKeyframeToleranceS = 0.005

const placeFragment = (
  job: HlsJob,
  time: number,
): { segment: number; sequence: number; complete: boolean } => {
  if (job.mode === 'hls_transcode') {
    const segment = segmentAt(job.segments, time + forcedKeyframeToleranceS)
    return { segment, sequence: segment + 1, complete: true }
  }
  const keyframe = nearestKeyframe(job.keyframes, time)
  const keyframeTime = job.keyframes[keyframe] ?? time
  const segment = segmentAt(job.segments, keyframeTime)
  const segmentStart = job.segments[segment]?.startS ?? 0
  const previousKeyframe = job.keyframes[keyframe - 1]
  const complete =
    keyframe === 0 || previousKeyframe === undefined || previousKeyframe < segmentStart - 1e-3
  return { segment, sequence: keyframe + 1, complete }
}

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
  presetsFile = join(transcodeDir, 'x264-presets.json'),
}: Deps): HlsSegmenter => {
  const presets = loadPresets(presetsFile)
  let knownFilters = filters
  const ffmpegFilters = (): FfmpegFilters => {
    knownFilters ??= detectFfmpegFilters(ffmpegBinary)
    return knownFilters
  }
  const sessions = new Map<string, SessionState>()
  let runCount = 0
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
    const temp = `${fileFor(state, segment)}.${run.id}.tmp`
    return { segment, temp, sink: complete ? Bun.file(temp).writer() : undefined }
  }

  const append = async (pending: Pending | undefined, bytes: Uint8Array): Promise<void> => {
    if (pending?.sink === undefined) return
    pending.sink.write(bytes)
    await pending.sink.flush()
  }

  const discard = async (pending: Pending | undefined): Promise<void> => {
    if (pending === undefined) return
    try {
      await pending.sink?.end()
      rmSync(pending.temp, { force: true })
    } catch {}
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
          run.throttled = true
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
              if (current !== undefined) {
                await finalize(state, current)
                measureSpeed(state, run, current.segment)
              }
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

  const argsFor = (
    job: HlsJob,
    fromSegment: number,
    vaapi: boolean,
    preset: X264Preset | undefined,
  ): string[] => {
    const segment = job.segments[fromSegment]
    const common = {
      sourcePath: job.sourcePath,
      startS: segment?.startS ?? 0,
      audioDownmix: job.audioDownmix,
      ...(job.audio === undefined ? {} : { audio: job.audio }),
    }
    if (job.mode === 'hls_remux') return remuxArgs({ ...common, video: job.video })
    const { quality, dynamicRange, burnIn } = job.transcode
    const aligned = job.segments.some((planned) => planned.onKeyframe === true)
    return transcodeArgs({
      ...common,
      video: { ...job.video, ...(dynamicRange === undefined ? {} : { dynamicRange }) },
      quality,
      ...(burnIn === undefined ? {} : { burnIn }),
      filters: ffmpegFilters(),
      ...(vaapi ? { vaapiDevice: renderNode } : {}),
      ...(aligned
        ? {
            cuts: job.segments.slice(fromSegment + 1).map((planned) => planned.startS),
            onKeyframe: segment?.onKeyframe === true,
          }
        : {}),
      ...(preset === undefined ? {} : { preset }),
    })
  }

  const presetFor = (state: SessionState, vaapi: boolean): X264Preset | undefined => {
    const { job } = state
    if (job.mode !== 'hls_transcode' || vaapi) return undefined
    state.preset ??= presets.get(presetKey(job)) ?? 'veryfast'
    return state.preset
  }

  const measureSpeed = (state: SessionState, run: Run, segment: number): void => {
    const sample = run.speed
    if (sample === undefined || sample.done) return
    if (run.throttled) {
      sample.done = true
      return
    }
    const endS = state.job.segments[segment]?.endS ?? 0
    const now = Date.now()
    if (sample.fromS === undefined) {
      sample.fromS = endS
      sample.at = now
      return
    }
    const contentS = endS - sample.fromS
    if (contentS < speedSampleS) return
    sample.done = true
    const speed = contentS / Math.max(0.001, (now - sample.at) / 1000)
    const next = nextPreset(sample.preset, speed)
    logger.debug('x264 speed measured', {
      sessionId: state.job.sessionId,
      preset: sample.preset,
      speed: Math.round(speed * 100) / 100,
    })
    if (next === sample.preset) return
    presets.set(presetKey(state.job), next)
    savePresets(presetsFile, presets)
    logger.info('x264 preset adapted to the server speed', {
      code: 'playback/x264_preset',
      sessionId: state.job.sessionId,
      from: sample.preset,
      to: next,
      speed: Math.round(speed * 100) / 100,
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
    const preset = presetFor(state, vaapi)
    try {
      mkdirSync(state.dir, { recursive: true })
      const proc = Bun.spawn({
        cmd: [ffmpegBinary, ...argsFor(job, fromSegment, vaapi, preset)],
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
        throttled: false,
        speed:
          preset === undefined
            ? undefined
            : { preset, fromS: undefined, at: Date.now(), done: false },
      }
      state.run = run
      logger.debug('ffmpeg HLS run started', {
        sessionId: job.sessionId,
        mode: job.mode,
        fromSegment,
        vaapi,
        ...(preset === undefined ? {} : { preset }),
      })
      if (job.mode === 'hls_transcode' && (job.transcode.dynamicRange ?? 'sdr') !== 'sdr') {
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
      preset: undefined,
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
        if (started?.fallback === true) started = undefined
        if (started !== undefined && started.finished && !started.killed) {
          return err(
            started.failed
              ? failed('ffmpeg failed', { sessionId: job.sessionId, segment: which })
              : neverProduced(job, which),
          )
        }
        const run = state.run
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
