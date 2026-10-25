import type { AppError, Result } from '@projo/shared'

/**
 * What playback needs from a probe (§6.2 `sources.probe`). `index` is the ffprobe stream index,
 * the one ffmpeg's `-map 0:<index>` takes. Codecs are ffprobe `codec_name`s (`h264`, `hevc`,
 * `aac`, `ac3`…). Attached pictures (cover art) are not video streams.
 */
export type VideoStreamInfo = {
  index: number
  codec: string
  profile?: string
  width?: number
  height?: number
  pixelFormat?: string
  /** `hdr`: PQ or HLG transfer; `dv`: Dolby Vision. Absent when the probe does not say. */
  dynamicRange?: 'sdr' | 'hdr' | 'dv'
  /** ffprobe `codec_tag_string` (`hvc1`, `hev1`, `avc1`…); absent from older stored probes. */
  codecTag?: string
  /**
   * Duration of the video stream itself (MP4 stream `duration`, MKV `DURATION` tag): audio or
   * subtitles may run past the last frame. Absent from older stored probes.
   */
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

/** A chapter of the file (ffprobe `-show_chapters`), milliseconds from the file start. */
export type ChapterInfo = {
  startMs: number
  endMs: number
  title?: string
}

export type MediaInfo = {
  /** ffprobe `format_name` (`matroska,webm`, `mov,mp4,m4a,3gp,3g2,mj2`…). */
  formatName?: string
  durationMs?: number
  video: VideoStreamInfo[]
  audio: AudioStreamInfo[]
  subtitles: SubtitleStreamInfo[]
  /** Absent from the probes stored before M3 (no chapter then). */
  chapters?: ChapterInfo[]
}

/** Live ffprobe of a file, when `sources.probe` is missing or unreadable. */
export type MediaProber = {
  probe: (path: string) => Promise<Result<MediaInfo, AppError<'media/ffprobe_failed'>>>
}

/** The audio track the browser would play by itself: the default one, else the first. */
export const defaultAudioStream = (media: MediaInfo): AudioStreamInfo | undefined =>
  media.audio.find((stream) => stream.isDefault) ?? media.audio[0]
