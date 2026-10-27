import { describe, expect, test } from 'bun:test'

import { appError, err, ok, type Result } from '@projo/shared'

import { createRecordingJobQueue } from '../../../test/support/fakes.ts'
import type { CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import type {
  HlsJob,
  HlsSegmenter,
  KeyframeStore,
  StoredKeyframeIndex,
} from '../../core/playback/ports.ts'
import type { PlaybackSession } from '../../core/playback/session.ts'
import type { SubtitleTrack, SubtitleTrackRepository } from '../../core/playback/subtitles.ts'
import { defaultPlaybackSettings, type PlaybackSettings } from '../../core/settings/settings.ts'
import { hlsStreamFactory } from './hls-stream.ts'
import type { AuthorizePlayback, SessionAccessError } from './session-lifecycle.ts'

const source: PlayableSource = {
  id: 'source-1',
  state: 'ready',
  libraryId: 'library-1',
  path: '/media/film.mkv',
  rootReachable: true,
  extension: 'mkv',
  sizeBytes: 1,
  mtime: 1,
  version: {},
  media: {
    durationMs: 10_000,
    video: [{ index: 0, codec: 'h264' }],
    audio: [],
    subtitles: [],
  },
}

const session: PlaybackSession = {
  id: 's1',
  profileId: 'profile-1',
  authSessionId: 'auth-1',
  accountId: 'account-1',
  sourceId: source.id,
  itemId: 'movie-1',
  mode: 'hls_remux',
  burnIn: false,
  startedAt: new Date(0),
  lastHeartbeatAt: new Date(0),
  positionMs: 0,
}

const noSubtitles: SubtitleTrackRepository = { listForSource: () => [], findById: () => undefined }

const access = { sessionId: 's1', accountId: 'account-1', profileId: 'p' }

/** A stream over one source and one session, recording the jobs handed to the segmenter. */
const streamFor = ({
  playing,
  media = source.media,
  tracks = [],
  settings = {},
}: {
  playing: PlaybackSession
  media?: PlayableSource['media']
  tracks?: SubtitleTrack[]
  settings?: Partial<PlaybackSettings>
}) => {
  const jobs: HlsJob[] = []
  const stream = hlsStreamFactory({
    authorize: () => ok(playing),
    catalogRepository: {
      findSource: () => ({ ...source, ...(media === undefined ? {} : { media }) }),
    } as unknown as CatalogRepository,
    keyframeStore: {
      read: () => ({ keyframes: [0, 2, 4, 6, 8], durationS: 10, sizeBytes: 1, mtime: 1 }),
      write: () => ok(),
    },
    mediaProber: {
      probe: async () => err(appError('media/ffprobe_failed', 'no probe in this test')),
    },
    jobQueue: createRecordingJobQueue().queue,
    segmenter: {
      segment: async (job) => {
        jobs.push(job)
        return ok('/cache/seg')
      },
      stop: () => {},
      stopAll: async () => {},
      sessionIds: () => [],
    },
    subtitleTrackRepository: {
      listForSource: () => tracks,
      findById: (id) => tracks.find((track) => track.id === id),
    },
    playbackSettings: { read: () => ({ ...defaultPlaybackSettings, ...settings }) },
    delay: async () => {},
  })
  return { stream, jobs }
}

const transcoding: PlaybackSession = {
  ...session,
  mode: 'hls_transcode',
  quality: '720p',
  audioStream: 1,
  audioDelivery: 'aac',
}

const media = {
  durationMs: 8_500,
  video: [{ index: 0, codec: 'hevc', dynamicRange: 'hdr' as const }],
  audio: [{ index: 1, codec: 'eac3', channels: 6, isDefault: true }],
  subtitles: [],
}

const pgs: SubtitleTrack = {
  id: 'sub-pgs',
  sourceId: source.id,
  origin: 'embedded',
  streamIndex: 3,
  forced: false,
  sdh: false,
  isDefault: false,
  format: 'pgs',
}

describe('hlsStream: hls_transcode sessions (§10.2, §10.3)', () => {
  test('the job follows the session row: quality, audio, settings, fixed 4 s plan', async () => {
    const { stream, jobs } = streamFor({
      playing: transcoding,
      media,
      settings: { audioDownmix: 'keep' },
    })
    const playlist = await stream.playlist(access)
    expect(playlist.ok).toBe(true)
    if (playlist.ok) {
      expect(playlist.value).toContain('#EXT-X-TARGETDURATION:5')
      expect(playlist.value.match(/#EXTINF:/g)?.length).toBe(2)
    }
    await stream.segment({ ...access, name: 'seg-00001.m4s' })
    expect(jobs[0]).toEqual({
      mode: 'hls_transcode',
      sessionId: 's1',
      sourcePath: source.path,
      segments: [
        { index: 0, startS: 0, endS: 4 },
        { index: 1, startS: 4, endS: 8.5 },
      ],
      startS: 0,
      video: { index: 0, codec: 'hevc' },
      audio: { index: 1, delivery: 'aac', channels: 6 },
      audioDownmix: 'keep',
      hwAccel: 'off',
      transcode: { quality: '720p', dynamicRange: 'hdr' },
    })
  })

  test('planned on the end of the video stream when audio runs longer', async () => {
    const { stream, jobs } = streamFor({
      playing: transcoding,
      media: {
        ...media,
        durationMs: 14_000,
        video: [{ index: 0, codec: 'hevc', durationMs: 10_000 }],
      },
    })
    await stream.segment({ ...access, name: 'init.mp4' })
    expect(jobs[0]?.segments).toEqual([
      { index: 0, startS: 0, endS: 4 },
      { index: 1, startS: 4, endS: 8 },
      { index: 2, startS: 8, endS: 10 },
    ])
  })

  test("the request's abort signal reaches the segmenter", async () => {
    const signals: (AbortSignal | undefined)[] = []
    const controller = new AbortController()
    const recording = hlsStreamFactory({
      authorize: () => ok(transcoding),
      catalogRepository: {
        findSource: () => ({ ...source, media }),
      } as unknown as CatalogRepository,
      keyframeStore: { read: () => undefined, write: () => ok() },
      mediaProber: { probe: async () => err(appError('media/ffprobe_failed', 'unused')) },
      jobQueue: createRecordingJobQueue().queue,
      segmenter: {
        segment: async (_job, _which, signal) => {
          signals.push(signal)
          return ok('/cache/seg')
        },
        stop: () => {},
        stopAll: async () => {},
        sessionIds: () => [],
      },
      subtitleTrackRepository: noSubtitles,
      playbackSettings: { read: () => defaultPlaybackSettings },
      delay: async () => {},
    })
    await recording.segment({ ...access, name: 'seg-00000.m4s', signal: controller.signal })
    expect(signals).toEqual([controller.signal])
  })

  test('no keyframe index is needed (none requested)', async () => {
    const { stream, jobs } = streamFor({
      playing: { ...session, mode: 'hls_transcode', audioStream: 1, audioDelivery: 'aac' },
      media,
    })
    await stream.segment({ ...access, name: 'init.mp4' })
    expect(jobs[0]).toMatchObject({ transcode: { quality: 'original' } })
    expect(jobs[0]).not.toHaveProperty('keyframes')
  })

  test('burn-in of an embedded bitmap track, or of an external .sup / VobSub', async () => {
    const external: SubtitleTrack = {
      ...pgs,
      id: 'sub-idx',
      origin: 'external',
      path: '/media/film.fr.idx',
      format: 'vobsub',
    }
    delete (external as { streamIndex?: number }).streamIndex
    for (const [track, burnIn] of [
      [pgs, { origin: 'embedded', streamIndex: 3 }],
      [external, { origin: 'external', path: '/media/film.fr.idx', format: 'vobsub' }],
    ] as const) {
      const { stream, jobs } = streamFor({
        playing: { ...transcoding, burnIn: true, subtitleTrackId: track.id },
        media,
        tracks: [pgs, external],
      })
      await stream.segment({ ...access, name: 'init.mp4' })
      expect(jobs[0]).toMatchObject({ transcode: { burnIn } })
    }
  })

  test('a burn-in track gone, of another source, or not bitmap: typed errors', async () => {
    const text: SubtitleTrack = { ...pgs, id: 'sub-srt', format: 'srt' }
    const other: SubtitleTrack = { ...pgs, id: 'sub-other', sourceId: 'source-2' }
    for (const [subtitleTrackId, code] of [
      ['gone', 'playback/subtitle_not_found'],
      ['sub-other', 'playback/subtitle_not_found'],
      ['sub-srt', 'playback/subtitle_unsupported'],
    ] as const) {
      const { stream, jobs } = streamFor({
        playing: { ...transcoding, burnIn: true, subtitleTrackId },
        media,
        tracks: [text, other],
      })
      expect(await stream.playlist(access)).toMatchObject({ ok: false, error: { code } })
      expect(jobs).toEqual([])
    }
  })

  test('remux sessions keep their keyframe plan; direct sessions are not HLS', async () => {
    const { stream, jobs } = streamFor({ playing: session })
    await stream.segment({ ...access, name: 'init.mp4' })
    expect(jobs[0]).toMatchObject({ mode: 'hls_remux', keyframes: [0, 2, 4, 6, 8] })
    const direct = streamFor({ playing: { ...session, mode: 'direct' } })
    expect(await direct.stream.playlist(access)).toMatchObject({
      ok: false,
      error: { code: 'playback/mode_unsupported' },
    })
  })
})

describe('hlsStream: session ended while waiting for the keyframe index (§10.3, §10.6)', () => {
  test('the request is re-authorized after the wait: no plan kept, no ffmpeg started', async () => {
    let ended = false
    let index: StoredKeyframeIndex | undefined
    const authorize: AuthorizePlayback = (): Result<PlaybackSession, SessionAccessError> =>
      ended ? err(appError('playback/session_expired', 'playback session ended')) : ok(session)
    const keyframeStore: KeyframeStore = { read: () => index, write: () => ok() }
    const segmentCalls: string[] = []
    const segmenter: HlsSegmenter = {
      segment: async (job) => {
        segmentCalls.push(job.sessionId)
        return ok('/cache/seg')
      },
      stop: () => {},
      stopAll: async () => {},
      sessionIds: () => [],
    }
    const stream = hlsStreamFactory({
      authorize,
      catalogRepository: { findSource: () => source } as unknown as CatalogRepository,
      keyframeStore,
      mediaProber: {
        probe: async () => {
          throw new Error('the source has a stored probe')
        },
      },
      jobQueue: createRecordingJobQueue().queue,
      segmenter,
      subtitleTrackRepository: noSubtitles,
      playbackSettings: { read: () => defaultPlaybackSettings },
      // While the index is being computed, the session ends (stop, timeout, cascade).
      delay: async () => {
        ended = true
        stream.forget(session.id)
        index = { keyframes: [0, 2, 4, 6, 8], durationS: 10, sizeBytes: 1, mtime: 1 }
      },
    })

    expect(
      await stream.segment({
        sessionId: 's1',
        accountId: 'account-1',
        profileId: 'p',
        name: 'init.mp4',
      }),
    ).toMatchObject({ ok: false, error: { code: 'playback/session_expired' } })
    expect(segmentCalls).toEqual([])
    expect(stream.sessionIds()).toEqual([])
  })
})
