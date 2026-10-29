import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type {
  AudioCodecId,
  ClientCapabilities,
  PlaybackQuality,
  VideoCodecId,
} from '@projo/shared/api/playback'

import type { AudioStreamInfo, MediaInfo, VideoStreamInfo } from './media-info.ts'

/**
 * §10.2 decision of the playback mode, from the probe, the client capabilities, the wanted
 * quality and whether a bitmap subtitle is burnt in: `direct`, `hls_remux` or `hls_transcode`.
 */

/** Browsers decode 8-bit 4:2:0 H.264 only: High 10 / 4:2:2 / 4:4:4 need a transcode. */
const isBrowserH264 = (stream: VideoStreamInfo): boolean => {
  const profile = stream.profile?.toLowerCase() ?? ''
  const pixelFormat = stream.pixelFormat ?? 'yuv420p'
  return (
    !/(high 10|4:2:2|4:4:4)/.test(profile) &&
    (pixelFormat === 'yuv420p' || pixelFormat === 'yuvj420p')
  )
}

/** ffprobe `codec_name` → the codec id the client reports, undefined when no browser plays it. */
export const videoCodecId = (stream: VideoStreamInfo): VideoCodecId | undefined => {
  switch (stream.codec) {
    case 'h264':
      return isBrowserH264(stream) ? 'avc1' : undefined
    case 'hevc':
      return 'hvc1'
    case 'av1':
      return 'av01'
    case 'vp9':
      return 'vp09'
    default:
      return undefined
  }
}

export const audioCodecId = (codec: string): AudioCodecId | undefined => {
  switch (codec) {
    case 'aac':
      return 'mp4a.40.2'
    case 'ac3':
      return 'ac-3'
    case 'eac3':
      return 'ec-3'
    case 'opus':
      return 'opus'
    case 'flac':
      return 'flac'
    default:
      return undefined
  }
}

/** Containers a `<video>` reads progressively (§10.2), by file extension, with the MIME served. */
const directContainers: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  // QuickTime is ISO BMFF: browsers play it when labelled MP4.
  mov: 'video/mp4',
  webm: 'video/webm',
}

export const directMimeType = (extension: string): string | undefined =>
  directContainers[extension.toLowerCase().replace(/^\./, '')]

/**
 * Audio codecs copied into fMP4 HLS segments when the client supports them. Apple's HLS spec and
 * hls.js both accept AAC, AC-3 and E-AC-3 in fMP4; Opus and FLAC in HLS are not reliable on
 * Safari, so they are transcoded (as DTS, TrueHD, MP3, PCM…).
 */
const hlsCopyableAudio: ReadonlySet<AudioCodecId> = new Set(['mp4a.40.2', 'ac-3', 'ec-3'])

export type AudioDelivery = 'direct' | 'copy' | 'aac'

/** Why the video is re-encoded: unsupported codec, lower quality asked, bitmap subtitle burnt in. */
export type TranscodeReason = 'video_codec' | 'quality' | 'burn_in'

export type PlaybackPlan =
  | {
      mode: 'direct'
      quality: 'original'
      mimeType: string
      video: VideoStreamInfo
      audio?: AudioStreamInfo
    }
  | {
      mode: 'hls_remux'
      quality: 'original'
      video: VideoStreamInfo
      videoCodec: VideoCodecId
      audio?: { stream: AudioStreamInfo; delivery: 'copy' | 'aac' }
    }
  | {
      mode: 'hls_transcode'
      /** The quality actually produced: the asked one, lowered to what the source allows. */
      quality: PlaybackQuality
      video: VideoStreamInfo
      reasons: TranscodeReason[]
      /** Always AAC in a transcode (§10.2). */
      audio?: { stream: AudioStreamInfo; delivery: 'aac' }
    }

export type DecidePlaybackError = AppError<'playback/mode_unsupported'>

type DecideInput = {
  media: MediaInfo
  extension: string
  capabilities: ClientCapabilities
  /** ffprobe index of the wanted audio track; default track of the file otherwise. */
  audioStreamIndex?: number
  quality: PlaybackQuality
  /** A bitmap subtitle track is burnt into the video (§10.4). */
  burnIn?: boolean
  /** A text subtitle track is shown: inside the stream for an `hls` client (§10.4), never direct. */
  textSubtitle?: boolean
}

/** Target height of each lower quality (§10.2: 8 / 4 / 1.5 Mb/s). */
export const qualityHeights: Record<Exclude<PlaybackQuality, 'original'>, number> = {
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
}

const lowerQualities = ['1080p', '720p', '480p'] as const

/**
 * Height the picture would have at 16:9 (a 1920×800 scope film is "1080p"): the larger of the
 * height and 9/16 of the width. Undefined when the probe has neither.
 */
const effectiveHeight = (video: VideoStreamInfo): number | undefined => {
  if (video.width === undefined && video.height === undefined) return undefined
  return Math.max(video.height ?? 0, Math.round(((video.width ?? 0) * 9) / 16))
}

/**
 * `original` plus the lower qualities not above the source height (never an upscale). A source
 * of unknown size offers them all; no video stream, only `original`.
 */
export const availableQualities = (video: VideoStreamInfo | undefined): PlaybackQuality[] => {
  if (video === undefined) return ['original']
  const height = effectiveHeight(video)
  return [
    'original',
    ...lowerQualities.filter(
      (quality) => height === undefined || qualityHeights[quality] <= height,
    ),
  ]
}

/** The asked quality, lowered to the best available one (a 720p source asked in 1080p: 720p). */
export const effectiveQuality = (
  video: VideoStreamInfo,
  quality: PlaybackQuality,
): PlaybackQuality => {
  if (quality === 'original') return quality
  const available = availableQualities(video)
  if (available.includes(quality)) return quality
  return available.find((candidate) => candidate !== 'original') ?? 'original'
}

const supportsAudio = (capabilities: ClientCapabilities, stream: AudioStreamInfo): boolean => {
  const id = audioCodecId(stream.codec)
  return id !== undefined && capabilities.audioCodecs.includes(id)
}

/** How a track reaches the browser once remuxed to HLS. */
export const hlsAudioDelivery = (
  capabilities: ClientCapabilities,
  stream: AudioStreamInfo,
): 'copy' | 'aac' => {
  const id = audioCodecId(stream.codec)
  return id !== undefined && hlsCopyableAudio.has(id) && capabilities.audioCodecs.includes(id)
    ? 'copy'
    : 'aac'
}

export const chooseAudioStream = (
  media: MediaInfo,
  audioStreamIndex: number | undefined,
): AudioStreamInfo | undefined =>
  (audioStreamIndex === undefined
    ? undefined
    : media.audio.find((stream) => stream.index === audioStreamIndex)) ??
  media.audio.find((stream) => stream.isDefault) ??
  media.audio[0]

const noHls = (context: Record<string, unknown>) =>
  err(
    appError('playback/mode_unsupported', 'the client cannot play HLS and the file needs it', {
      context,
    }),
  )

/** The video codec of the file is decoded by this client (no video transcode needed for it). */
export const isVideoSupported = (
  video: VideoStreamInfo,
  capabilities: ClientCapabilities,
): boolean => {
  const codec = videoCodecId(video)
  return codec !== undefined && capabilities.videoCodecs.includes(codec)
}

export const decidePlayback = ({
  media,
  extension,
  capabilities,
  audioStreamIndex,
  quality,
  burnIn = false,
  textSubtitle = false,
}: DecideInput): Result<PlaybackPlan, DecidePlaybackError> => {
  const video = media.video[0]
  if (video === undefined) {
    return err(appError('playback/mode_unsupported', 'source has no video stream'))
  }
  const codec = videoCodecId(video)
  const audio = chooseAudioStream(media, audioStreamIndex)
  const target = effectiveQuality(video, quality)
  const reasons: TranscodeReason[] = [
    ...(codec === undefined || !capabilities.videoCodecs.includes(codec)
      ? (['video_codec'] as const)
      : []),
    ...(target === 'original' ? [] : (['quality'] as const)),
    ...(burnIn ? (['burn_in'] as const) : []),
  ]
  // `codec === undefined` implies the `video_codec` reason; tested again for the narrowing below.
  if (codec === undefined || reasons.length > 0) {
    if (capabilities.hls === 'none') {
      return noHls({ videoCodec: video.codec, quality: target, burnIn })
    }
    return ok({
      mode: 'hls_transcode',
      quality: target,
      video,
      reasons,
      ...(audio === undefined ? {} : { audio: { stream: audio, delivery: 'aac' as const } }),
    })
  }

  const mimeType = directMimeType(extension)
  // A <video> only plays the first audio track of a file.
  const audioIsFirst = audio === undefined || media.audio[0]?.index === audio.index
  // Safari plays HEVC tagged `hvc1` only: an `hev1` file goes through the remux, which retags it.
  // A probe without the tag (stored before it was read) is trusted as before.
  const directTag = video.codecTag?.toLowerCase() !== 'hev1'
  const subtitlesInStream = textSubtitle && capabilities.subtitleDelivery === 'hls'
  if (
    !subtitlesInStream &&
    mimeType !== undefined &&
    audioIsFirst &&
    directTag &&
    (audio === undefined || supportsAudio(capabilities, audio))
  ) {
    return ok({
      mode: 'direct',
      quality: 'original',
      mimeType,
      video,
      ...(audio === undefined ? {} : { audio }),
    })
  }

  if (capabilities.hls === 'none') return noHls({ extension, audioCodec: audio?.codec })
  return ok({
    mode: 'hls_remux',
    quality: 'original',
    video,
    videoCodec: codec,
    ...(audio === undefined
      ? {}
      : { audio: { stream: audio, delivery: hlsAudioDelivery(capabilities, audio) } }),
  })
}
