import type { AppError, Result } from '@projo/shared'

import { normalizeLanguage } from '../naming/index.ts'
import type { DynamicRange } from './version.ts'

/**
 * Result of `ffprobe` (§7.3), stored in `sources.probe`. Stream `index` is the absolute ffprobe
 * stream index (what `-map 0:<index>` expects). Attached pictures (cover art) are not videos.
 */
export type VideoStream = {
  index: number
  codec: string
  profile?: string
  width?: number
  height?: number
  pixelFormat?: string
  /** Frames per second (`avg_frame_rate`). */
  frameRate?: number
  bitRate?: number
  dynamicRange: DynamicRange
  isDefault: boolean
  /** `codec_tag_string` (`hvc1`, `hev1`…), when ffprobe gives a meaningful one. */
  codecTag?: string
  /** Of the video stream alone (stream `duration`, else the Matroska `DURATION` tag). */
  durationMs?: number
}

export type AudioStream = {
  index: number
  codec: string
  profile?: string
  channels?: number
  channelLayout?: string
  sampleRate?: number
  bitRate?: number
  /** Normalized (`fr`, `pt-BR`); absent when untagged or `und`. */
  language?: string
  title?: string
  isDefault: boolean
}

export type SubtitleStream = {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault: boolean
  forced: boolean
  sdh: boolean
}

export type Chapter = { startMs: number; endMs: number; title?: string }

export type MediaProbe = {
  durationMs: number
  /** ffprobe `format_name`, e.g. `matroska,webm`, `mov,mp4,m4a,3gp,3g2,mj2`. */
  container: string
  bitRate?: number
  video: VideoStream[]
  audio: AudioStream[]
  subtitles: SubtitleStream[]
  chapters: Chapter[]
}

export type MediaError = AppError<
  | 'media/ffprobe_failed'
  | 'media/ffmpeg_failed'
  | 'media/binary_missing'
  | 'media/invalid_probe_output'
  | 'media/timeout'
>

/** `ffprobe -show_format -show_streams -show_chapters` (§7.3 step 4). */
export type MediaProber = {
  probe: (input: { path: string; signal?: AbortSignal }) => Promise<Result<MediaProbe, MediaError>>
}

/** `ffmpeg -ss <t> -i <f> -t <d> -f null -`: `err` on any decoding error or when nothing decodes. */
export type MediaDecoder = {
  decodeSample: (input: {
    path: string
    startSeconds: number
    durationSeconds: number
    signal?: AbortSignal
  }) => Promise<Result<void, MediaError>>
}

/** §7.3: a usable file has a positive duration and at least one video stream. */
export const probeDefect = (probe: MediaProbe): 'no_duration' | 'no_video' | undefined => {
  if (!(probe.durationMs > 0)) return 'no_duration'
  if (probe.video.length === 0) return 'no_video'
  return undefined
}

export const SAMPLE_SECONDS = 2

/** Start offsets (seconds) of the three 2 s decodes at 10 %, 50 % and 90 % of the duration (§7.3). */
export const sampleOffsets = (durationMs: number): number[] => {
  const duration = durationMs / 1000
  const latestStart = Math.max(0, duration - SAMPLE_SECONDS)
  return [0.1, 0.5, 0.9].map(
    (ratio) => Math.round(Math.min(duration * ratio, latestStart) * 1000) / 1000,
  )
}

/** §7.6: size, duration to the millisecond and the list of streams. Stable across renames and copies. */
export const signatureOf = (sizeBytes: number, probe: MediaProbe): string => {
  const streams = [
    ...probe.video.map((s) => ({ index: s.index, tag: `v:${s.codec}` })),
    ...probe.audio.map((s) => ({ index: s.index, tag: `a:${s.codec}` })),
    ...probe.subtitles.map((s) => ({ index: s.index, tag: `s:${s.codec}` })),
  ]
    .sort((a, b) => a.index - b.index)
    .map((s) => s.tag)
  return `v1|${sizeBytes}|${Math.round(probe.durationMs)}|${streams.join(',')}`
}

const EMBEDDED_FORMATS: Readonly<Record<string, string>> = {
  subrip: 'srt',
  srt: 'srt',
  ass: 'ass',
  ssa: 'ssa',
  webvtt: 'vtt',
  mov_text: 'mov_text',
  hdmv_pgs_subtitle: 'pgs',
  dvd_subtitle: 'vobsub',
  dvb_subtitle: 'dvb',
}

export type EmbeddedSubtitle = {
  streamIndex: number
  language?: string
  forced: boolean
  sdh: boolean
  isDefault: boolean
  format: string
  title?: string
}

/** Rows of `source_subtitles` (`kind = embedded`) for a probed file. */
export const embeddedSubtitlesOf = (probe: MediaProbe): EmbeddedSubtitle[] =>
  probe.subtitles.map((stream) => ({
    streamIndex: stream.index,
    forced: stream.forced,
    sdh: stream.sdh,
    isDefault: stream.isDefault,
    format: EMBEDDED_FORMATS[stream.codec] ?? stream.codec,
    ...(stream.language === undefined ? {} : { language: stream.language }),
    ...(stream.title === undefined ? {} : { title: stream.title }),
  }))

/** ffprobe language tag (639-2, `und`…) → normalized code or `undefined`. */
export const probeLanguage = (tag: string | undefined): string | undefined =>
  tag === undefined || tag === '' || tag.toLowerCase() === 'und'
    ? undefined
    : normalizeLanguage(tag)
