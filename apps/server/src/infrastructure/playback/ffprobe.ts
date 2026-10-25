import { z } from 'zod'

import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { MediaInfo, MediaProber } from '../../core/playback/media-info.ts'
import type { KeyframeExtractor } from '../../core/playback/ports.ts'
import type { KeyframeIndex } from '../../core/playback/hls-playlist.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { matroskaKeyframesOf } from './matroska-cues.ts'
import { readMediaInfo } from './probe-reader.ts'

type ProbeError = AppError<'media/ffprobe_failed'>

const failure = (message: string, context: Record<string, unknown>, cause?: unknown): ProbeError =>
  appError('media/ffprobe_failed', message, {
    context,
    ...(cause === undefined ? {} : { cause }),
  })

/** Runs ffprobe (arguments as an array, never a shell: §20) and returns its stdout. */
const run = async (
  binary: string,
  args: string[],
  signal?: AbortSignal,
): Promise<Result<string, ProbeError>> => {
  try {
    const proc = Bun.spawn({
      cmd: [binary, ...args],
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      ...(signal === undefined ? {} : { signal }),
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) {
      return err(failure('ffprobe failed', { code, stderr: stderr.slice(-2000) }))
    }
    return ok(stdout)
  } catch (cause) {
    return err(failure('cannot run ffprobe', { binary }, cause))
  }
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

export const createFfprobe = ({ binary = 'ffprobe' }: { binary?: string } = {}): MediaProber &
  KeyframeExtractor => ({
  probe: async (path): Promise<Result<MediaInfo, ProbeError>> => {
    const output = await run(binary, [
      '-v',
      'error',
      '-show_format',
      '-show_streams',
      '-show_chapters',
      '-of',
      'json',
      fileInput(path),
    ])
    if (!output.ok) return output
    const media = readMediaInfo(parseJson(output.value))
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
    if (keyframes.length === 0) return err(failure('no keyframe found', { path, videoStreamIndex }))
    const last = keyframes[keyframes.length - 1] ?? 0
    return ok({ keyframes, durationS: durationS ?? last })
  },
})
