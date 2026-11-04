import type { AppError, Result } from '@projo/shared'

export type VideoStreamInfo = {
  index: number
  codec: string
  profile?: string
  width?: number
  height?: number
  pixelFormat?: string
  dynamicRange?: 'sdr' | 'hdr' | 'dv'
  codecTag?: string
  durationMs?: number
}

export type AudioStreamInfo = {
  index: number
  codec: string
  profile?: string
  channels?: number
  language?: string
  title?: string
  isDefault: boolean
}

export type SubtitleStreamInfo = {
  index: number
  codec: string
  language?: string
  title?: string
  isDefault: boolean
  forced: boolean
}

export type ChapterInfo = {
  startMs: number
  endMs: number
  title?: string
}

export type MediaInfo = {
  formatName?: string
  durationMs?: number
  video: VideoStreamInfo[]
  audio: AudioStreamInfo[]
  subtitles: SubtitleStreamInfo[]
  chapters?: ChapterInfo[]
}

export type MediaProber = {
  probe: (path: string) => Promise<Result<MediaInfo, AppError<'media/ffprobe_failed'>>>
}
