import type { AppError, Result } from '@projo/shared'
import type { PlaybackQuality } from '@projo/shared/api/playback'

import type { PlaybackSettings } from '../settings/settings.ts'
import type { HlsSegment, KeyframeIndex } from './hls-playlist.ts'

/** Keyframe index of a source, with the file identity it was computed from (stale when it changes). */
export type StoredKeyframeIndex = KeyframeIndex & {
  sizeBytes: number
  mtime: number
}

/** `/data/cache/keyframes/<source>.json` (§5.4). */
export type KeyframeStore = {
  read: (sourceId: string) => StoredKeyframeIndex | undefined
  write: (
    sourceId: string,
    index: StoredKeyframeIndex,
  ) => Result<void, AppError<'playback/keyframes_unavailable'>>
}

export const isFreshIndex = (
  index: StoredKeyframeIndex | undefined,
  source: { sizeBytes: number; mtime: number },
): index is StoredKeyframeIndex =>
  index !== undefined && index.sizeBytes === source.sizeBytes && index.mtime === source.mtime

/** ffprobe of the keyframe timestamps of one video stream (§10.3). */
export type KeyframeExtractor = {
  extract: (input: {
    path: string
    videoStreamIndex: number
    signal?: AbortSignal
  }) => Promise<Result<KeyframeIndex, AppError<'media/ffprobe_failed'>>>
}

/** The audio track of an HLS session: copied, or encoded to AAC (§10.2). */
export type HlsAudio = {
  index: number
  delivery: 'copy' | 'aac'
  /** Source channel count: kept when `audioDownmix` is `keep` (the AAC bitrate follows). */
  channels?: number
}

/** A bitmap subtitle track burnt into the video (§10.4). */
export type BurnInSubtitle =
  | { origin: 'embedded'; streamIndex: number }
  | { origin: 'external'; path: string; format: 'pgs' | 'vobsub' }

/** What `hls_transcode` changes on the video: H.264 at a quality, maybe a burnt-in track. */
export type HlsTranscode = {
  quality: PlaybackQuality
  dynamicRange?: 'sdr' | 'hdr' | 'dv'
  burnIn?: BurnInSubtitle
}

type HlsJobBase = {
  sessionId: string
  sourcePath: string
  segments: readonly HlsSegment[]
  video: { index: number; codec: string }
  audio?: HlsAudio
  /** §10.2 `settings.audio_downmix`, for audio encoded to AAC. */
  audioDownmix: PlaybackSettings['audioDownmix']
  /** §10.3: accepted by the argument builders, only `off` implemented in v1. */
  hwAccel: PlaybackSettings['hwAccel']
}

/**
 * Everything ffmpeg needs to produce a session's fMP4 HLS segments. Remux cuts on the source
 * keyframes; transcode forces a keyframe at every segment start (fixed 4 s segments).
 */
export type HlsJob =
  | (HlsJobBase & {
      mode: 'hls_remux'
      /** Sorted keyframe times: fragments are matched to them. */
      keyframes: readonly number[]
    })
  | (HlsJobBase & { mode: 'hls_transcode'; transcode: HlsTranscode })

export type SegmentError = AppError<
  'playback/segment_not_found' | 'playback/segment_timeout' | 'playback/stream_failed'
>

/**
 * Produces a session's segments on demand, one ffmpeg at a time (§10.3): a requested segment
 * outside the production window restarts ffmpeg at its start; one not yet written is awaited.
 */
export type HlsSegmenter = {
  /** Absolute path of `init.mp4` or of segment `n`, once written; `signal`: the request's. */
  segment: (
    job: HlsJob,
    which: number | 'init',
    signal?: AbortSignal,
  ) => Promise<Result<string, SegmentError>>
  /** Kills the session's ffmpeg (its files stay until the cache is purged). */
  stop: (sessionId: string) => void
  stopAll: () => Promise<void>
  /** Sessions it holds state (maybe an ffmpeg) for. */
  sessionIds: () => string[]
}

/** `/data/cache/transcode/<session>/` directories. */
export type TranscodeCache = {
  listSessionIds: () => string[]
  remove: (sessionId: string) => void
}

export type TranscodeCacheEntry = { sessionId: string; sizeBytes: number }

/** Disk use of `/data/cache/transcode`, per session folder (`cleanup_cache`, §10.3). */
export type TranscodeCacheInventory = {
  entries: () => TranscodeCacheEntry[]
  remove: (sessionId: string) => void
}
