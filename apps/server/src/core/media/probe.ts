import type { AppError, Result } from '@projo/shared'

import { normalizeLanguage } from '../naming/index.ts'
import type { DynamicRange } from './version.ts'

export type VideoStream = {
  index: number
  codec: string
  profile?: string
  width?: number
  height?: number
  pixelFormat?: string
  frameRate?: number
  bitRate?: number
  dynamicRange: DynamicRange
  isDefault: boolean
  codecTag?: string
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

export type MediaProber = {
  probe: (input: { path: string; signal?: AbortSignal }) => Promise<Result<MediaProbe, MediaError>>
}

export type MediaDecoder = {
  decodeSample: (input: {
    path: string
    startSeconds: number
    durationSeconds: number
    signal?: AbortSignal
  }) => Promise<Result<void, MediaError>>
}

export const probeDefect = (probe: MediaProbe): 'no_duration' | 'no_video' | undefined => {
  if (!(probe.durationMs > 0)) return 'no_duration'
  if (probe.video.length === 0) return 'no_video'
  return undefined
}

export const SAMPLE_SECONDS = 2

export const sampleOffsets = (durationMs: number): number[] => {
  const duration = durationMs / 1000
  const latestStart = Math.max(0, duration - SAMPLE_SECONDS)
  return [0.1, 0.5, 0.9].map(
    (ratio) => Math.round(Math.min(duration * ratio, latestStart) * 1000) / 1000,
  )
}

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

export const probeLanguage = (tag: string | undefined): string | undefined =>
  tag === undefined || tag === '' || tag.toLowerCase() === 'und'
    ? undefined
    : normalizeLanguage(tag)
