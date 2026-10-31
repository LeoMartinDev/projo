import { z } from 'zod'

import type {
  AudioStreamInfo,
  ChapterInfo,
  MediaInfo,
  SubtitleStreamInfo,
  VideoStreamInfo,
} from '../../core/playback/media-info.ts'
import { parseDurationTag, rawDynamicRange } from '../media/ffprobe.ts'

/**
 * Tolerant reader of `sources.probe` (written by the scanner). Accepts the raw ffprobe JSON
 * (`-show_format -show_streams`: `{ format, streams }`) and a normalized camelCase shape
 * (`{ durationMs | duration, formatName | container, streams | video/audio/subtitles }`).
 * Unknown fields are ignored; a value that does not fit is dropped rather than failing.
 */

const looseNumber = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^-?\d+(\.\d+)?$/)
      .transform(Number),
  ])
  .optional()
  .catch(undefined)
const looseString = z.string().optional().catch(undefined)
const looseFlag = z
  .union([z.boolean(), z.number().transform((value) => value !== 0)])
  .optional()
  .catch(undefined)

const streamSchema = z.looseObject({
  index: looseNumber,
  streamIndex: looseNumber,
  codec_type: looseString,
  codecType: looseString,
  type: looseString,
  codec_name: looseString,
  codecName: looseString,
  codec: looseString,
  profile: looseString,
  width: looseNumber,
  height: looseNumber,
  pix_fmt: looseString,
  pixFmt: looseString,
  pixelFormat: looseString,
  channels: looseNumber,
  language: looseString,
  title: looseString,
  default: looseFlag,
  isDefault: looseFlag,
  forced: looseFlag,
  attachedPic: looseFlag,
  dynamicRange: z.enum(['sdr', 'hdr', 'dv']).optional().catch(undefined),
  color_transfer: looseString,
  codec_tag_string: looseString,
  codecTag: looseString,
  duration: looseNumber,
  durationMs: looseNumber,
  side_data_list: z
    .array(z.looseObject({ side_data_type: looseString }))
    .optional()
    .catch(undefined),
  tags: z
    .looseObject({
      language: looseString,
      title: looseString,
      DURATION: looseString,
      duration: looseString,
    })
    .optional()
    .catch(undefined),
  disposition: z
    .looseObject({ default: looseFlag, forced: looseFlag, attached_pic: looseFlag })
    .optional()
    .catch(undefined),
})
type RawStream = z.infer<typeof streamSchema>

const streamList = z.array(z.unknown()).optional().catch(undefined)

/** Normalized (`startMs`, `endMs`, `title`) or raw ffprobe (`start_time`, `end_time`, `tags`). */
const chapterSchema = z.looseObject({
  startMs: looseNumber,
  endMs: looseNumber,
  start_time: looseNumber,
  end_time: looseNumber,
  title: looseString,
  tags: z.looseObject({ title: looseString }).optional().catch(undefined),
})

const probeSchema = z.looseObject({
  format: z
    .looseObject({ format_name: looseString, duration: looseNumber })
    .optional()
    .catch(undefined),
  formatName: looseString,
  container: looseString,
  durationMs: looseNumber,
  duration: looseNumber,
  streams: streamList,
  video: streamList,
  audio: streamList,
  subtitles: streamList,
  chapters: streamList,
})

type Kind = 'video' | 'audio' | 'subtitle'

const parseStreams = (
  values: unknown[] | undefined,
  kind?: Kind,
): (RawStream & { kind?: Kind })[] =>
  (values ?? []).flatMap((value) => {
    const parsed = streamSchema.safeParse(value)
    return parsed.success ? [{ ...parsed.data, ...(kind === undefined ? {} : { kind }) }] : []
  })

const kindOf = (stream: RawStream & { kind?: Kind }): string | undefined =>
  stream.kind ?? stream.codec_type ?? stream.codecType ?? stream.type

const normalizeLanguage = (language: string | undefined): string | undefined =>
  language === undefined || language === '' || language === 'und' ? undefined : language

const common = (stream: RawStream) => {
  const index = stream.index ?? stream.streamIndex
  const codec = stream.codec_name ?? stream.codecName ?? stream.codec
  return index === undefined || codec === undefined ? undefined : { index, codec }
}

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

/** Normalized probes carry `dynamicRange`; raw ffprobe JSON is read like the scanner does. */
const dynamicRangeOf = (stream: RawStream): VideoStreamInfo['dynamicRange'] =>
  stream.dynamicRange ?? rawDynamicRange(stream)

/** Normalized `codecTag`, or a real fourcc of raw ffprobe (Matroska says `[0][0][0][0]`). */
const codecTagOf = (stream: RawStream): string | undefined => {
  const value = stream.codecTag ?? stream.codec_tag_string
  return value !== undefined && /^[A-Za-z0-9]{4}$/.test(value) ? value.toLowerCase() : undefined
}

const videoDurationMs = (stream: RawStream): number | undefined => {
  if (stream.durationMs !== undefined && stream.durationMs > 0) return Math.round(stream.durationMs)
  if (stream.duration !== undefined && stream.duration > 0) {
    return Math.round(stream.duration * 1000)
  }
  return parseDurationTag(stream.tags?.DURATION ?? stream.tags?.duration)
}

const toVideo = (stream: RawStream): VideoStreamInfo | undefined => {
  const base = common(stream)
  if (base === undefined) return undefined
  if (stream.disposition?.attached_pic === true || stream.attachedPic === true) return undefined
  return {
    ...base,
    ...optional('profile', stream.profile),
    ...optional('width', stream.width),
    ...optional('height', stream.height),
    ...optional('pixelFormat', stream.pix_fmt ?? stream.pixFmt ?? stream.pixelFormat),
    ...optional('dynamicRange', dynamicRangeOf(stream)),
    ...optional('codecTag', codecTagOf(stream)),
    ...optional('durationMs', videoDurationMs(stream)),
  }
}

const isDefault = (stream: RawStream): boolean =>
  stream.disposition?.default ?? stream.isDefault ?? stream.default ?? false

const toAudio = (stream: RawStream): AudioStreamInfo | undefined => {
  const base = common(stream)
  if (base === undefined) return undefined
  return {
    ...base,
    ...optional('profile', stream.profile),
    ...optional('channels', stream.channels),
    ...optional('language', normalizeLanguage(stream.tags?.language ?? stream.language)),
    ...optional('title', stream.tags?.title ?? stream.title),
    isDefault: isDefault(stream),
  }
}

const toSubtitle = (stream: RawStream): SubtitleStreamInfo | undefined => {
  const base = common(stream)
  if (base === undefined) return undefined
  return {
    ...base,
    ...optional('language', normalizeLanguage(stream.tags?.language ?? stream.language)),
    ...optional('title', stream.tags?.title ?? stream.title),
    isDefault: isDefault(stream),
    forced: stream.disposition?.forced ?? stream.forced ?? false,
  }
}

const defined = <T>(values: (T | undefined)[]): T[] =>
  values.filter((value): value is T => value !== undefined)

const toChapter = (value: unknown): ChapterInfo | undefined => {
  const parsed = chapterSchema.safeParse(value)
  if (!parsed.success) return undefined
  const chapter = parsed.data
  const seconds = (s: number | undefined) => (s === undefined ? undefined : Math.round(s * 1000))
  const startMs = chapter.startMs ?? seconds(chapter.start_time)
  const endMs = chapter.endMs ?? seconds(chapter.end_time)
  if (startMs === undefined || endMs === undefined || endMs < startMs) return undefined
  const title = chapter.title ?? chapter.tags?.title
  return {
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    ...optional('title', title === '' ? undefined : title),
  }
}

/** `undefined` when the value has no stream at all (absent or unreadable probe). */
export const readMediaInfo = (value: unknown): MediaInfo | undefined => {
  const parsed = probeSchema.safeParse(value)
  if (!parsed.success) return undefined
  const probe = parsed.data
  const streams = [
    ...parseStreams(probe.streams),
    ...parseStreams(probe.video, 'video'),
    ...parseStreams(probe.audio, 'audio'),
    ...parseStreams(probe.subtitles, 'subtitle'),
  ]
  if (streams.length === 0) return undefined
  const byIndex = (a: { index: number }, b: { index: number }) => a.index - b.index
  const durationS = probe.format?.duration ?? probe.duration
  const durationMs = probe.durationMs ?? (durationS === undefined ? undefined : durationS * 1000)
  const formatName = probe.format?.format_name ?? probe.formatName ?? probe.container
  return {
    ...optional('formatName', formatName),
    ...optional('durationMs', durationMs === undefined ? undefined : Math.round(durationMs)),
    video: defined(streams.filter((s) => kindOf(s) === 'video').map(toVideo)).sort(byIndex),
    audio: defined(streams.filter((s) => kindOf(s) === 'audio').map(toAudio)).sort(byIndex),
    subtitles: defined(
      streams.filter((s) => kindOf(s) === 'subtitle' || kindOf(s) === 'subtitles').map(toSubtitle),
    ).sort(byIndex),
    // Absent from the probes stored before chapters were read: left absent, not empty.
    ...(probe.chapters === undefined
      ? {}
      : { chapters: defined(probe.chapters.map(toChapter)).sort((a, b) => a.startMs - b.startMs) }),
  }
}
