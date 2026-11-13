import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type {
  AudioCodecId,
  ClientCapabilities,
  PlaybackQuality,
  VideoCodecId,
} from '@projo/shared/api/playback'

import type { AudioStreamInfo, MediaInfo, VideoStreamInfo } from './media-info.ts'

const isBrowserH264 = (stream: VideoStreamInfo): boolean => {
  const profile = stream.profile?.toLowerCase() ?? ''
  const pixelFormat = stream.pixelFormat ?? 'yuv420p'
  return (
    !/(high 10|4:2:2|4:4:4)/.test(profile) &&
    (pixelFormat === 'yuv420p' || pixelFormat === 'yuvj420p')
  )
}

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

const directContainers: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/mp4',
  webm: 'video/webm',
}

const bareExtension = (extension: string): string => extension.toLowerCase().replace(/^\./, '')

export const directMimeType = (extension: string): string | undefined =>
  directContainers[bareExtension(extension)]

const otherContainers: Record<string, string> = {
  mkv: 'video/x-matroska',
  mk3d: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mts: 'video/mp2t',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ogv: 'video/ogg',
  ogm: 'video/ogg',
  '3gp': 'video/3gpp',
}

/** Media type of a file served whole: the engine (mpv) reads any container (§10.2). */
export const fileMimeType = (extension: string): string =>
  directMimeType(extension) ??
  otherContainers[bareExtension(extension)] ??
  'application/octet-stream'

const hlsCopyableAudio: ReadonlySet<AudioCodecId> = new Set(['mp4a.40.2', 'ac-3', 'ec-3'])

export type AudioDelivery = 'direct' | 'copy' | 'aac'

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
      quality: PlaybackQuality
      video: VideoStreamInfo
      reasons: TranscodeReason[]
      audio?: { stream: AudioStreamInfo; delivery: 'aac' }
    }

export type DecidePlaybackError = AppError<'playback/mode_unsupported'>

type DecideInput = {
  media: MediaInfo
  extension: string
  capabilities: ClientCapabilities
  audioStreamIndex?: number
  quality: PlaybackQuality
  burnIn?: boolean
  textSubtitle?: boolean
}

export const qualityHeights: Record<Exclude<PlaybackQuality, 'original'>, number> = {
  '1080p': 1080,
  '720p': 720,
  '480p': 480,
}

const lowerQualities = ['1080p', '720p', '480p'] as const

const effectiveHeight = (video: VideoStreamInfo): number | undefined => {
  if (video.width === undefined && video.height === undefined) return undefined
  return Math.max(video.height ?? 0, Math.round(((video.width ?? 0) * 9) / 16))
}

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

/**
 * mpv decodes every container and codec and draws every subtitle: Original always plays the file
 * as is, whatever its container, video (10-bit, HDR, Dolby Vision), audio (DTS, TrueHD) or
 * subtitles (never burned in); only a lower quality transcodes (§10.2).
 */
const decideForEngine = ({
  extension,
  capabilities,
  video,
  audio,
  target,
}: {
  extension: string
  capabilities: ClientCapabilities
  video: VideoStreamInfo
  audio: AudioStreamInfo | undefined
  target: PlaybackQuality
}): Result<PlaybackPlan, DecidePlaybackError> => {
  if (target === 'original') {
    return ok({
      mode: 'direct',
      quality: 'original',
      mimeType: fileMimeType(extension),
      video,
      ...(audio === undefined ? {} : { audio }),
    })
  }
  if (capabilities.hls === 'none') return noHls({ quality: target })
  return ok({
    mode: 'hls_transcode',
    quality: target,
    video,
    reasons: ['quality'],
    ...(audio === undefined ? {} : { audio: { stream: audio, delivery: 'aac' as const } }),
  })
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
  const audio = chooseAudioStream(media, audioStreamIndex)
  const target = effectiveQuality(video, quality)
  if (capabilities.engine === 'mpv') {
    return decideForEngine({ extension, capabilities, video, audio, target })
  }
  const codec = videoCodecId(video)
  const reasons: TranscodeReason[] = [
    ...(codec === undefined || !capabilities.videoCodecs.includes(codec)
      ? (['video_codec'] as const)
      : []),
    ...(target === 'original' ? [] : (['quality'] as const)),
    ...(burnIn ? (['burn_in'] as const) : []),
  ]
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
  const audioIsFirst = audio === undefined || media.audio[0]?.index === audio.index
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
