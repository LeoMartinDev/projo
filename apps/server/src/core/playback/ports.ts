import type { AppError, Result } from '@projo/shared'
import type { PlaybackQuality } from '@projo/shared/api/playback'

import type { PlaybackSettings } from '../settings/settings.ts'
import type { HlsSegment, KeyframeIndex } from './hls-playlist.ts'

export type StoredKeyframeIndex = KeyframeIndex & {
  sizeBytes: number
  mtime: number
}

export type KeyframeStore = {
  read: (sourceId: string) => StoredKeyframeIndex | undefined
  write: (
    sourceId: string,
    index: StoredKeyframeIndex,
  ) => Result<void, AppError<'playback/keyframes_unavailable'>>
}

export type KeyframeCleanup = {
  listSourceIds: () => string[]
  remove: (sourceId: string) => void
}

export const isFreshIndex = (
  index: StoredKeyframeIndex | undefined,
  source: { sizeBytes: number; mtime: number },
): index is StoredKeyframeIndex =>
  index !== undefined && index.sizeBytes === source.sizeBytes && index.mtime === source.mtime

export type KeyframeExtractor = {
  extract: (input: {
    path: string
    videoStreamIndex: number
    signal?: AbortSignal
  }) => Promise<Result<KeyframeIndex, AppError<'media/ffprobe_failed'>>>
}

export type HlsAudio = {
  index: number
  delivery: 'copy' | 'aac'
  channels?: number
}

export type BurnInSubtitle =
  | { origin: 'embedded'; streamIndex: number }
  | { origin: 'external'; path: string; format: 'pgs' | 'vobsub' }

export type HlsTranscode = {
  quality: PlaybackQuality
  dynamicRange?: 'sdr' | 'hdr' | 'dv'
  burnIn?: BurnInSubtitle
}

type HlsJobBase = {
  sessionId: string
  sourcePath: string
  segments: readonly HlsSegment[]
  startS?: number
  video: { index: number; codec: string; height?: number; pixelFormat?: string }
  audio?: HlsAudio
  audioDownmix: PlaybackSettings['audioDownmix']
  hwAccel: PlaybackSettings['hwAccel']
}

export type HlsJob =
  | (HlsJobBase & {
      mode: 'hls_remux'
      keyframes: readonly number[]
    })
  | (HlsJobBase & { mode: 'hls_transcode'; transcode: HlsTranscode })

export type SegmentError = AppError<
  'playback/segment_not_found' | 'playback/segment_timeout' | 'playback/stream_failed'
>

export type HlsSegmenter = {
  segment: (
    job: HlsJob,
    which: number | 'init',
    signal?: AbortSignal,
  ) => Promise<Result<string, SegmentError>>
  stop: (sessionId: string) => void
  stopAll: () => Promise<void>
  sessionIds: () => string[]
}

export type TranscodeCache = {
  listSessionIds: () => string[]
  remove: (sessionId: string) => void
}

export type TranscodeCacheEntry = { sessionId: string; sizeBytes: number }

export type TranscodeCacheInventory = {
  entries: () => TranscodeCacheEntry[]
  remove: (sessionId: string) => void
}
