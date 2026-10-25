import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository } from '../../core/catalog/catalog.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import {
  parseSegmentName,
  planFixedSegments,
  planSegments,
  renderPlaylist,
} from '../../core/playback/hls-playlist.ts'
import type { MediaInfo, MediaProber } from '../../core/playback/media-info.ts'
import {
  type BurnInSubtitle,
  type HlsAudio,
  type HlsJob,
  type HlsSegmenter,
  isFreshIndex,
  type KeyframeStore,
  type SegmentError,
  type StoredKeyframeIndex,
} from '../../core/playback/ports.ts'
import type { PlaybackSession } from '../../core/playback/session.ts'
import { isBitmapSubtitle, type SubtitleTrackRepository } from '../../core/playback/subtitles.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import { keyframePriority, requestKeyframes } from './index-keyframes.ts'
import type { AuthorizePlayback, PlaybackAccess, SessionAccessError } from './session-lifecycle.ts'

type Deps = {
  authorize: AuthorizePlayback
  catalogRepository: CatalogRepository
  keyframeStore: KeyframeStore
  mediaProber: MediaProber
  jobQueue: JobQueue
  segmenter: HlsSegmenter
  subtitleTrackRepository: SubtitleTrackRepository
  /** `audioDownmix`, `hwAccel`: read when a session's plan is built. */
  playbackSettings: PlaybackSettingsReader
  /** Pause between two looks at the keyframe index while `index_keyframes` runs. */
  delay: (ms: number) => Promise<void>
  /** §10.3: a player waits this long for the index (then 503, it retries). */
  keyframeWaitMs?: number
  pollMs?: number
}

export type HlsStreamError =
  | SessionAccessError
  | SegmentError
  | AppError<
      | 'playback/source_unavailable'
      | 'playback/keyframes_unavailable'
      | 'playback/mode_unsupported'
      | 'playback/subtitle_not_found'
      | 'playback/subtitle_unsupported'
    >

type SubtitleError = AppError<'playback/subtitle_not_found' | 'playback/subtitle_unsupported'>

/**
 * `GET /stream/:sessionId/index.m3u8` and `/:segment` for `hls_remux` and `hls_transcode`
 * sessions, run as the session row says (mode, quality, audio track and delivery, burnt-in
 * track): the mode is decided when the session is created. The plan (remux: keyframes →
 * segments; transcode: fixed 4 s segments from the duration) is computed once per session and
 * kept until the session ends.
 */
export const hlsStreamFactory = ({
  authorize,
  catalogRepository,
  keyframeStore,
  mediaProber,
  jobQueue,
  segmenter,
  subtitleTrackRepository,
  playbackSettings,
  delay,
  keyframeWaitMs = 20_000,
  pollMs = 250,
}: Deps) => {
  const jobs = new Map<string, HlsJob>()

  const waitForKeyframes = async (source: {
    id: string
    sizeBytes: number
    mtime: number
  }): Promise<Result<StoredKeyframeIndex, AppError<'playback/keyframes_unavailable'>>> => {
    for (let waited = 0; ; waited += pollMs) {
      const index = keyframeStore.read(source.id)
      if (isFreshIndex(index, source)) return ok(index)
      if (waited === 0) requestKeyframes(jobQueue, source.id, keyframePriority.interactive)
      if (waited >= keyframeWaitMs) {
        return err(
          appError('playback/keyframes_unavailable', 'keyframe index not ready yet', {
            context: { sourceId: source.id },
          }),
        )
      }
      await delay(pollMs)
    }
  }

  /** §10.4: the bitmap track of the session's source to burn in. */
  const burnInFor = (session: PlaybackSession): Result<BurnInSubtitle, SubtitleError> => {
    if (session.subtitleTrackId === undefined && session.subtitleStream !== undefined) {
      return ok({ origin: 'embedded', streamIndex: session.subtitleStream })
    }
    const track =
      session.subtitleTrackId === undefined
        ? undefined
        : subtitleTrackRepository.findById(session.subtitleTrackId)
    if (track === undefined || track.sourceId !== session.sourceId) {
      return err(
        appError('playback/subtitle_not_found', 'subtitle track to burn in not found', {
          context: { sessionId: session.id, subtitleTrackId: session.subtitleTrackId },
        }),
      )
    }
    const unsupported = err(
      appError('playback/subtitle_unsupported', 'subtitle track cannot be burnt in', {
        context: { sessionId: session.id, subtitleTrackId: track.id, format: track.format },
      }),
    )
    if (!isBitmapSubtitle(track)) return unsupported
    if (track.origin === 'embedded') {
      return track.streamIndex === undefined
        ? unsupported
        : ok({ origin: 'embedded', streamIndex: track.streamIndex })
    }
    if (track.path === undefined || (track.format !== 'pgs' && track.format !== 'vobsub')) {
      return unsupported
    }
    return ok({ origin: 'external', path: track.path, format: track.format })
  }

  const mediaOf = async (source: {
    id: string
    path: string
    media?: MediaInfo
  }): Promise<Result<MediaInfo, AppError<'playback/source_unavailable'>>> => {
    if (source.media !== undefined && source.media.video.length > 0) return ok(source.media)
    const probed = await mediaProber.probe(source.path)
    if (!probed.ok) {
      return err(
        appError('playback/source_unavailable', 'source cannot be probed', {
          context: { sourceId: source.id },
          cause: probed.error,
        }),
      )
    }
    return ok(probed.value)
  }

  const jobFor = async (
    session: PlaybackSession,
    access: PlaybackAccess,
  ): Promise<Result<HlsJob, HlsStreamError>> => {
    const cached = jobs.get(session.id)
    if (cached !== undefined) return ok(cached)
    const mode = session.mode
    if (mode !== 'hls_remux' && mode !== 'hls_transcode') {
      return err(
        appError('playback/mode_unsupported', 'not an HLS session', {
          context: { sessionId: session.id, mode },
        }),
      )
    }
    const source = catalogRepository.findSource(session.sourceId)
    if (source === undefined || source.state !== 'ready' || !source.rootReachable) {
      return err(
        appError('playback/source_unavailable', 'source unavailable', {
          context: { sourceId: session.sourceId },
        }),
      )
    }
    const media = await mediaOf(source)
    if (!media.ok) return media
    const video = media.value.video[0]
    if (video === undefined) {
      return err(
        appError('playback/source_unavailable', 'source has no video stream', {
          context: { sourceId: source.id },
        }),
      )
    }
    const audioStream =
      session.audioStream === undefined
        ? undefined
        : media.value.audio.find((stream) => stream.index === session.audioStream)
    const audio: HlsAudio | undefined =
      audioStream === undefined
        ? undefined
        : {
            index: audioStream.index,
            delivery: session.audioDelivery ?? 'aac',
            ...(audioStream.channels === undefined ? {} : { channels: audioStream.channels }),
          }
    const settings = playbackSettings.read()
    const common = {
      sessionId: session.id,
      sourcePath: source.path,
      video: { index: video.index, codec: video.codec },
      audioDownmix: settings.audioDownmix,
      hwAccel: settings.hwAccel,
      ...(audio === undefined ? {} : { audio }),
    }

    let job: HlsJob
    if (mode === 'hls_transcode') {
      // Planned on the video stream's end when the probe has it: a segment past the last frame
      // (audio or subtitles running longer) would never be produced.
      const durationS = (video.durationMs ?? media.value.durationMs ?? 0) / 1000
      if (!(durationS > 0)) {
        return err(
          appError('playback/source_unavailable', 'source duration unknown', {
            context: { sourceId: source.id },
          }),
        )
      }
      const burnIn = session.burnIn ? burnInFor(session) : undefined
      if (burnIn !== undefined && !burnIn.ok) return burnIn
      job = {
        ...common,
        mode,
        segments: planFixedSegments(durationS),
        transcode: {
          quality: session.quality ?? 'original',
          ...(video.dynamicRange === undefined ? {} : { dynamicRange: video.dynamicRange }),
          ...(burnIn === undefined ? {} : { burnIn: burnIn.value }),
        },
      }
    } else {
      const index = await waitForKeyframes(source)
      if (!index.ok) return index
      job = {
        ...common,
        mode,
        segments: planSegments(index.value),
        keyframes: index.value.keyframes,
      }
    }
    // The session may have ended during a wait (keyframe index, probe): stop, timeout, deleted
    // source. Keeping a plan or handing it to the segmenter would bring back a finished session.
    const stillAuthorized = authorize(access)
    if (!stillAuthorized.ok) return stillAuthorized
    jobs.set(session.id, job)
    return ok(job)
  }

  const authorizedJob = async (input: PlaybackAccess): Promise<Result<HlsJob, HlsStreamError>> => {
    const access = {
      sessionId: input.sessionId,
      accountId: input.accountId,
      profileId: input.profileId,
    }
    const session = authorize(access)
    return session.ok ? jobFor(session.value, access) : session
  }

  return {
    playlist: async (input: PlaybackAccess): Promise<Result<string, HlsStreamError>> => {
      const job = await authorizedJob(input)
      return job.ok ? ok(renderPlaylist(job.value.segments)) : job
    },

    /** Absolute path of `init.mp4` or `seg-NNNNN.m4s`, produced on demand. */
    segment: async (
      input: PlaybackAccess & { name: string; signal?: AbortSignal },
    ): Promise<Result<string, HlsStreamError>> => {
      const which = parseSegmentName(input.name)
      if (which === undefined) {
        return err(
          appError('playback/segment_not_found', 'no such segment', {
            context: { sessionId: input.sessionId, name: input.name },
          }),
        )
      }
      const job = await authorizedJob(input)
      return job.ok ? segmenter.segment(job.value, which, input.signal) : job
    },

    forget: (sessionId: string): void => {
      jobs.delete(sessionId)
    },

    /** Sessions whose plan is kept (the sweep releases those of sessions gone). */
    sessionIds: (): string[] => [...jobs.keys()],
  }
}

export type HlsStream = ReturnType<typeof hlsStreamFactory>
