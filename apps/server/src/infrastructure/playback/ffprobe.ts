import { z } from 'zod'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { MediaInfo, MediaProber } from '../../core/playback/media-info.ts'
import type { KeyframeExtractor } from '../../core/playback/ports.ts'
import type { KeyframeIndex } from '../../core/playback/hls-playlist.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { createFfprobeProber } from '../media/ffprobe.ts'
import { type ProcessPriority, runProcess, stderrTail } from '../media/process.ts'
import { matroskaKeyframesOf } from './matroska-cues.ts'
import { readMediaInfo } from './probe-reader.ts'

type ProbeError = AppError<'media/ffprobe_failed'>

const failure = (message: string, context: Record<string, unknown>, cause?: unknown): ProbeError =>
  appError('media/ffprobe_failed', message, {
    context,
    ...(cause === undefined ? {} : { cause }),
  })

/**
 * The keyframe scan reads every packet of the video stream, minutes for a big file on a network
 * share; past this, ffprobe is hung and killed.
 */
const KEYFRAME_SCAN_TIMEOUT_MS = 30 * 60_000

/** Runs ffprobe through `runProcess` (arguments as an array, §20; killed on timeout or abort). */
const run = async (
  binary: string,
  priority: ProcessPriority,
  args: string[],
  signal?: AbortSignal,
): Promise<Result<string, ProbeError>> => {
  const output = await runProcess({
    command: binary,
    args,
    timeoutMs: KEYFRAME_SCAN_TIMEOUT_MS,
    priority,
    ...(signal === undefined ? {} : { signal }),
  })
  if (!output.ok) return err(failure('cannot run ffprobe', { binary }, output.error))
  if (output.value.exitCode !== 0) {
    return err(
      failure('ffprobe failed', {
        code: output.value.exitCode,
        stderr: stderrTail(output.value.stderr, 2000),
      }),
    )
  }
  return ok(output.value.stdout)
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Keyframe times (seconds) made relative to `startS`, to the microsecond, sorted and unique. */
const relativeKeyframes = (times: readonly number[], startS: number): number[] =>
  [...new Set(times.map((time) => Math.max(0, Math.round((time - startS) * 1e6) / 1e6)))].sort(
    (a, b) => a - b,
  )

/** Keyframe pts (seconds) from `pts_time,flags` CSV lines, relative to `startS`. */
export const parseKeyframeCsv = (csv: string, startS: number): number[] => {
  const times: number[] = []
  for (const line of csv.split('\n')) {
    const [pts, flags] = line.trim().split(',')
    if (pts === undefined || flags === undefined || !flags.startsWith('K')) continue
    const value = Number(pts)
    if (Number.isFinite(value)) times.push(value)
  }
  return relativeKeyframes(times, startS)
}

const formatSchema = z.object({
  format: z
    .looseObject({
      start_time: z.coerce.number().optional().catch(undefined),
      duration: z.coerce.number().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
})

const readFormat = (value: unknown): { startS: number; durationS?: number } => {
  const parsed = formatSchema.safeParse(value)
  const format = parsed.success ? parsed.data.format : undefined
  const start = format?.start_time
  const duration = format?.duration
  return {
    startS: start !== undefined && Number.isFinite(start) ? start : 0,
    ...(duration !== undefined && Number.isFinite(duration) && duration > 0
      ? { durationS: duration }
      : {}),
  }
}

/** `file:` keeps ffmpeg from reading a path as a protocol or an option (§20). */
export const fileInput = (path: string): string => `file:${toHostPath(path)}`

/**
 * `processPriority`: `background` for the instance of the background `index_keyframes` jobs
 * (§18), `normal` (default) for what a player waits for.
 */
export const createFfprobe = ({
  binary = 'ffprobe',
  processPriority = 'normal',
  probeTimeoutMs,
}: {
  binary?: string
  processPriority?: ProcessPriority
  /** Default: the scanner prober's (60 s). */
  probeTimeoutMs?: number
} = {}): MediaProber & KeyframeExtractor => {
  const prober = createFfprobeProber({
    binary,
    processPriority,
    ...(probeTimeoutMs === undefined ? {} : { timeoutMs: probeTimeoutMs }),
  })
  return {
    // The scanner's prober (60 s timeout), read like a stored probe: one ffprobe call and parser.
    probe: async (path): Promise<Result<MediaInfo, ProbeError>> => {
      const probed = await prober.probe({ path })
      if (!probed.ok) {
        const { error } = probed
        return err(
          error.code === 'media/ffprobe_failed'
            ? { ...error, code: error.code }
            : failure(error.message, { path, ...error.context }, error),
        )
      }
      const media = readMediaInfo(probed.value)
      return media === undefined ? err(failure('ffprobe returned no stream', { path })) : ok(media)
    },

    /**
     * §10.3: the cues of a Matroska file when they list every keyframe (`matroska-cues.ts`), else
     * `ffprobe -select_streams <v> -show_entries packet=pts_time,flags`, which reads every packet
     * of the video stream (no decoding). Times are made relative to the container start, like
     * ffmpeg's `-ss` and `-start_at_zero`.
     */
    extract: async ({
      path,
      videoStreamIndex,
      signal,
    }): Promise<Result<KeyframeIndex, ProbeError>> => {
      const format = await run(
        binary,
        processPriority,
        [
          '-v',
          'error',
          '-show_entries',
          'format=start_time,duration',
          '-of',
          'json',
          fileInput(path),
        ],
        signal,
      )
      if (!format.ok) return format
      const { startS, durationS } = readFormat(parseJson(format.value))
      const fromCues = await matroskaKeyframesOf(path)
      if (fromCues !== undefined) {
        const keyframes = relativeKeyframes(fromCues, startS)
        return ok({ keyframes, durationS: durationS ?? keyframes[keyframes.length - 1] ?? 0 })
      }
      const packets = await run(
        binary,
        processPriority,
        [
          '-v',
          'error',
          '-select_streams',
          String(videoStreamIndex),
          '-show_entries',
          'packet=pts_time,flags',
          '-of',
          'csv=p=0',
          fileInput(path),
        ],
        signal,
      )
      if (!packets.ok) return packets
      const keyframes = parseKeyframeCsv(packets.value, startS)
      if (keyframes.length === 0)
        return err(failure('no keyframe found', { path, videoStreamIndex }))
      const last = keyframes[keyframes.length - 1] ?? 0
      return ok({ keyframes, durationS: durationS ?? last })
    },
  }
}
