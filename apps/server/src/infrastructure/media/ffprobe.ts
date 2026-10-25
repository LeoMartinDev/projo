import { z } from 'zod'

import { appError, err, ok, type Result } from '@projo/shared'

import {
  type AudioStream,
  type Chapter,
  type MediaError,
  type MediaProbe,
  type MediaProber,
  probeLanguage,
  type SubtitleStream,
  type VideoStream,
} from '../../core/media/probe.ts'
import type { DynamicRange } from '../../core/media/version.ts'
import { toHostPath } from '../fs/host-paths.ts'
import { runProcess, stderrTail } from './process.ts'

// ffprobe prints numbers as strings in many places: accept both.
const numeric = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(parsed)) {
    ctx.addIssue({ code: 'custom', message: 'not a number' })
    return z.NEVER
  }
  return parsed
})

const dispositionSchema = z
  .object({
    default: z.number().optional(),
    forced: z.number().optional(),
    hearing_impaired: z.number().optional(),
    attached_pic: z.number().optional(),
  })
  .partial()

const streamSchema = z.object({
  index: z.number().int(),
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  profile: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  pix_fmt: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional(),
  bit_rate: numeric.optional(),
  channels: z.number().int().optional(),
  channel_layout: z.string().optional(),
  sample_rate: numeric.optional(),
  color_transfer: z.string().optional(),
  codec_tag_string: z.string().optional(),
  duration: numeric.optional(),
  disposition: dispositionSchema.optional(),
  tags: z.record(z.string(), z.unknown()).optional(),
  side_data_list: z.array(z.record(z.string(), z.unknown())).optional(),
})

const probeOutputSchema = z.object({
  format: z
    .object({
      format_name: z.string().optional(),
      duration: numeric.optional(),
      bit_rate: numeric.optional(),
    })
    .optional(),
  streams: z.array(streamSchema).default([]),
  chapters: z
    .array(
      z.object({
        start_time: numeric.optional(),
        end_time: numeric.optional(),
        tags: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .default([]),
})

type RawStream = z.infer<typeof streamSchema>

const tag = (tags: Record<string, unknown> | undefined, name: string): string | undefined => {
  if (tags === undefined) return undefined
  const entry = Object.entries(tags).find(([key]) => key.toLowerCase() === name)
  return typeof entry?.[1] === 'string' && entry[1] !== '' ? entry[1] : undefined
}

const frameRateOf = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined
  const [num, den] = value.split('/').map(Number)
  if (num === undefined || den === undefined || !Number.isFinite(num) || !(den > 0))
    return undefined
  const rate = num / den
  return rate > 0 ? Math.round(rate * 1000) / 1000 : undefined
}

const dynamicRangeOf = (stream: RawStream): DynamicRange => {
  const doviSideData = (stream.side_data_list ?? []).some((entry) =>
    String(entry['side_data_type'] ?? '')
      .toLowerCase()
      .includes('dovi'),
  )
  const doviTag = ['dvh1', 'dvhe', 'dav1', 'dva1'].includes(
    (stream.codec_tag_string ?? '').toLowerCase(),
  )
  if (doviSideData || doviTag) return 'dv'
  return stream.color_transfer === 'smpte2084' || stream.color_transfer === 'arib-std-b67'
    ? 'hdr'
    : 'sdr'
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const flag = (value: number | undefined): boolean => value === 1

/** A real fourcc (`hvc1`, `avc1`); Matroska reports `[0][0][0][0]`. */
const codecTagOf = (stream: RawStream): string | undefined => {
  const value = stream.codec_tag_string
  return value !== undefined && /^[A-Za-z0-9]{4}$/.test(value) ? value.toLowerCase() : undefined
}

/** `HH:MM:SS.fraction` (the Matroska `DURATION` tag) → milliseconds. */
export const parseDurationTag = (value: string | undefined): number | undefined => {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value ?? '') ?? undefined
  if (match === undefined) return undefined
  const ms = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined
}

const streamDurationMs = (stream: RawStream): number | undefined =>
  stream.duration !== undefined && stream.duration > 0
    ? Math.round(stream.duration * 1000)
    : parseDurationTag(tag(stream.tags, 'duration'))

const toVideo = (stream: RawStream): VideoStream => ({
  index: stream.index,
  codec: stream.codec_name ?? 'unknown',
  ...optional('profile', stream.profile),
  ...optional('width', stream.width),
  ...optional('height', stream.height),
  ...optional('pixelFormat', stream.pix_fmt),
  ...optional('frameRate', frameRateOf(stream.avg_frame_rate) ?? frameRateOf(stream.r_frame_rate)),
  ...optional('bitRate', stream.bit_rate),
  dynamicRange: dynamicRangeOf(stream),
  isDefault: flag(stream.disposition?.default),
  ...optional('codecTag', codecTagOf(stream)),
  ...optional('durationMs', streamDurationMs(stream)),
})

const toAudio = (stream: RawStream): AudioStream => ({
  index: stream.index,
  codec: stream.codec_name ?? 'unknown',
  ...optional('profile', stream.profile),
  ...optional('channels', stream.channels),
  ...optional('channelLayout', stream.channel_layout),
  ...optional('sampleRate', stream.sample_rate),
  ...optional('bitRate', stream.bit_rate),
  ...optional('language', probeLanguage(tag(stream.tags, 'language'))),
  ...optional('title', tag(stream.tags, 'title')),
  isDefault: flag(stream.disposition?.default),
})

const toSubtitle = (stream: RawStream): SubtitleStream => {
  const title = tag(stream.tags, 'title')
  const lowerTitle = title?.toLowerCase() ?? ''
  return {
    index: stream.index,
    codec: stream.codec_name ?? 'unknown',
    ...optional('language', probeLanguage(tag(stream.tags, 'language'))),
    ...optional('title', title),
    isDefault: flag(stream.disposition?.default),
    forced: flag(stream.disposition?.forced) || /\bforced\b/u.test(lowerTitle),
    sdh: flag(stream.disposition?.hearing_impaired) || /\b(sdh|cc)\b/u.test(lowerTitle),
  }
}

/** Raw ffprobe JSON → `MediaProbe`. Exported for tests. */
export const parseProbeOutput = (stdout: string): Result<MediaProbe, MediaError> => {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch (cause) {
    return err(appError('media/invalid_probe_output', 'ffprobe output is not JSON', { cause }))
  }
  const parsed = probeOutputSchema.safeParse(json)
  if (!parsed.success) {
    return err(
      appError('media/invalid_probe_output', 'unexpected ffprobe output', {
        context: { issues: parsed.error.issues.slice(0, 5) },
      }),
    )
  }
  const { format, streams, chapters } = parsed.data
  const isPicture = (s: RawStream) => flag(s.disposition?.attached_pic)
  const chapterList: Chapter[] = chapters.flatMap((chapter) =>
    chapter.start_time === undefined || chapter.end_time === undefined
      ? []
      : [
          {
            startMs: Math.round(chapter.start_time * 1000),
            endMs: Math.round(chapter.end_time * 1000),
            ...optional('title', tag(chapter.tags, 'title')),
          },
        ],
  )
  return ok({
    durationMs: Math.round((format?.duration ?? 0) * 1000),
    container: format?.format_name ?? 'unknown',
    ...optional('bitRate', format?.bit_rate),
    video: streams.filter((s) => s.codec_type === 'video' && !isPicture(s)).map(toVideo),
    audio: streams.filter((s) => s.codec_type === 'audio').map(toAudio),
    subtitles: streams.filter((s) => s.codec_type === 'subtitle').map(toSubtitle),
    chapters: chapterList,
  })
}

/** `MediaProber` over the `ffprobe` binary (§7.3 step 4). */
export const createFfprobeProber = ({
  binary = 'ffprobe',
  timeoutMs = 60_000,
}: { binary?: string; timeoutMs?: number } = {}): MediaProber => ({
  probe: async ({ path, signal }) => {
    const run = await runProcess({
      command: binary,
      args: [
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-show_chapters',
        '-of',
        'json',
        '-i',
        // `file:` stops ffmpeg from reading a protocol or option in the name (§20).
        `file:${toHostPath(path)}`,
      ],
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    })
    if (!run.ok) return run
    if (run.value.exitCode !== 0) {
      return err(
        appError('media/ffprobe_failed', 'ffprobe could not read the file', {
          context: { path, exitCode: run.value.exitCode, stderr: stderrTail(run.value.stderr) },
        }),
      )
    }
    return parseProbeOutput(run.value.stdout)
  },
})
