import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'
import type { ClientCapabilities, PlaybackQuality } from '@projo/shared/api/playback'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingJobQueue, createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { CatalogItem, CatalogRepository, PlayableSource } from '../../core/catalog/catalog.ts'
import type { MediaInfo, SubtitleStreamInfo } from '../../core/playback/media-info.ts'
import type { ProfileTrackDefaults } from '../../core/playback/resolve-tracks.ts'
import type { PlaybackSession } from '../../core/playback/session.ts'
import type { SubtitleTrack } from '../../core/playback/subtitles.ts'
import type { TrackPreferences } from '../../core/playback/track-preferences.ts'
import type { ItemProgress, ProgressRepository } from '../../core/progress/progress.ts'
import { defaultPlaybackSettings, type PlaybackSettings } from '../../core/settings/settings.ts'
import { createPlaybackSessionFactory } from './create-session.ts'

const oldChrome: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}
const safari: ClientCapabilities = {
  videoCodecs: ['avc1', 'hvc1'],
  audioCodecs: ['mp4a.40.2', 'ac-3', 'ec-3'],
  hls: 'native',
}

const media = (
  videoCodec: string,
  audioCodec: string,
  {
    height = 1080,
    durationMs = 3_600_000,
    audio,
    ...extra
  }: Partial<MediaInfo> & { height?: number } = {},
): MediaInfo => ({
  durationMs,
  video: [
    {
      index: 0,
      codec: videoCodec,
      pixelFormat: 'yuv420p',
      width: Math.round((height * 16) / 9),
      height,
    },
  ],
  audio: audio ?? [{ index: 1, codec: audioCodec, isDefault: true }],
  subtitles: [] as SubtitleStreamInfo[],
  ...extra,
})

const source = (
  id: string,
  extension: string,
  info: MediaInfo,
  extra: Partial<PlayableSource> = {},
): PlayableSource => ({
  id,
  state: 'ready',
  libraryId: 'library-1',
  path: `/media/${id}.${extension}`,
  rootReachable: true,
  extension,
  sizeBytes: 1,
  mtime: 1,
  version: {},
  media: info,
  ...extra,
})

const hevc4k = source('hevc-4k', 'mkv', media('hevc', 'eac3', { height: 2160 }))
const h264 = source('h264-1080p', 'mp4', media('h264', 'aac'))

const item = (id: string, kind: CatalogItem['kind'], extra: Partial<CatalogItem> = {}) =>
  ({
    id,
    kind,
    title: id,
    sortTitle: id,
    genres: [],
    createdAt: new Date(0),
    ...extra,
  }) as CatalogItem

const french: ProfileTrackDefaults = {
  audioLanguage: 'fr',
  subtitleLanguage: 'fr',
  subtitleMode: 'when_audio_differs',
  animeOriginalAudio: true,
}

type World = {
  sources: PlayableSource[]
  items?: CatalogItem[]
  subtitles?: Record<string, SubtitleTrack[]>
  sourceItems?: Record<string, string[]>
  settings?: Partial<PlaybackSettings>
  sessions?: PlaybackSession[]
  memory?: TrackPreferences[]
  progress?: ItemProgress[]
}

const build = (world: World) => {
  const clock = createManualClock(new Date('2026-10-23T12:00:00.000Z'))
  const items = new Map(
    (world.items ?? [item('movie-1', 'movie')]).map((entry) => [entry.id, entry] as const),
  )
  const sessions: PlaybackSession[] = [...(world.sessions ?? [])]
  const progress = new Map(
    (world.progress ?? []).map((entry) => [`${entry.profileId}|${entry.itemId}`, entry] as const),
  )
  const subtitles = world.subtitles ?? {}
  const catalogRepository = {
    findVisible: ({ id }: { id: string }) => items.get(id),
    listReadySources: () => world.sources,
    listMediaSegments: () => [],
    listSourceItemIds: (sourceId: string) => world.sourceItems?.[sourceId] ?? [],
  } as unknown as CatalogRepository
  const progressRepository = {
    find: ({ profileId, itemId }: { profileId: string; itemId: string }) =>
      progress.get(`${profileId}|${itemId}`),
    save: (entry: ItemProgress) => void progress.set(`${entry.profileId}|${entry.itemId}`, entry),
    showAncestorsAgain: () => {},
  } as unknown as ProgressRepository
  const create = createPlaybackSessionFactory({
    catalogRepository,
    progressRepository,
    sessionRepository: {
      insert: (session) => void sessions.push({ ...session, accountId: 'account-1' }),
      findById: (id) => sessions.find((session) => session.id === id),
      heartbeat: () => {},
      end: () => {},
      listStale: () => [],
      listActive: () => sessions.filter((session) => session.endedAt === undefined),
      listActiveWithin: () => [],
    },
    subtitleTrackRepository: {
      listForSource: (sourceId) => subtitles[sourceId] ?? [],
      findById: (id) =>
        Object.values(subtitles)
          .flat()
          .find((track) => track.id === id),
    },
    trackPreferenceRepository: {
      find: ({ profileId, itemId }) =>
        world.memory?.find((entry) => entry.profileId === profileId && entry.itemId === itemId),
      save: () => {},
      delete: () => false,
    },
    profileTracks: () => french,
    playbackSettings: { read: () => ({ ...defaultPlaybackSettings, ...world.settings }) },
    mediaProber: {
      probe: async () => {
        throw new Error('every source has a stored probe')
      },
    },
    keyframeStore: { read: () => undefined, write: () => ok() },
    jobQueue: createRecordingJobQueue().queue,
    trickplayReady: (sourceId) => sourceId === 'h264-1080p',
    clock,
    ids: createSequentialIds('ps-'),
    logger: silentLogger,
  })
  const play = (
    input: {
      itemId?: string
      sourceId?: string
      capabilities?: ClientCapabilities
      quality?: PlaybackQuality
      startPositionMs?: number
      audioStreamIndex?: number
      subtitleTrackId?: string
      authSessionId?: string
    } = {},
  ) => {
    const { itemId = 'movie-1', capabilities = oldChrome, quality = 'original', ...rest } = input
    return create({
      accountId: 'account-1',
      authSessionId: 'auth-1',
      profileId: 'profile-1',
      itemId,
      capabilities,
      quality,
      scope: {},
      ...rest,
    })
  }
  return { play, sessions, progress, clock }
}

describe('createPlaybackSession: version choice (§7.7)', () => {
  test('the best version playable without a video transcode on this client', async () => {
    const { play } = build({ sources: [hevc4k, h264] })
    expect(await play()).toMatchObject({
      ok: true,
      value: {
        source: { id: 'h264-1080p' },
        plan: { mode: 'direct' },
        versions: [
          { sourceId: 'hevc-4k', selected: false },
          { sourceId: 'h264-1080p', selected: true },
        ],
      },
    })
    // Safari decodes HEVC: the 4K version wins.
    expect(await play({ capabilities: safari })).toMatchObject({
      value: { source: { id: 'hevc-4k' }, plan: { mode: 'hls_remux' } },
    })
  })

  test('none playable without a transcode: the highest resolution, transcoded', async () => {
    const hevc1080 = source('hevc-1080p', 'mkv', media('hevc', 'aac'), { sizeBytes: 99 })
    const { play, sessions } = build({ sources: [hevc1080, hevc4k] })
    expect(await play()).toMatchObject({
      ok: true,
      value: {
        source: { id: 'hevc-4k' },
        plan: { mode: 'hls_transcode', quality: 'original', reasons: ['video_codec'] },
      },
    })
    expect(sessions[0]).toMatchObject({
      mode: 'hls_transcode',
      quality: 'original',
      audioStream: 1,
      audioDelivery: 'aac',
      burnIn: false,
    })
  })

  test('an explicit sourceId is kept even when another version would play', async () => {
    const { play } = build({ sources: [hevc4k, h264] })
    expect(await play({ sourceId: 'hevc-4k' })).toMatchObject({
      value: { source: { id: 'hevc-4k' }, plan: { mode: 'hls_transcode' } },
    })
    expect(await play({ sourceId: 'unknown' })).toMatchObject({
      ok: false,
      error: { code: 'playback/source_unavailable' },
    })
  })

  test('an unreachable version is skipped; all unreachable: its error', async () => {
    const offline = { ...h264, id: 'offline', rootReachable: false, sizeBytes: 99 }
    expect(await build({ sources: [offline, hevc4k] }).play()).toMatchObject({
      value: { source: { id: 'hevc-4k' } },
    })
    expect(await build({ sources: [offline] }).play()).toMatchObject({
      ok: false,
      error: { code: 'playback/source_unavailable' },
    })
    expect(await build({ sources: [] }).play()).toMatchObject({
      ok: false,
      error: { code: 'item/no_playable_source' },
    })
  })
})

describe('createPlaybackSession: parts (§7.7, §8.4)', () => {
  const cd1 = source('cd1', 'mp4', media('h264', 'aac', { durationMs: 1_000_000 }), {
    stackGroupId: 'stack',
    partIndex: 1,
    version: { resolution: '1080p', videoCodec: 'h264' },
  })
  const cd2 = source('cd2', 'mp4', media('h264', 'aac', { durationMs: 2_000_000 }), {
    stackGroupId: 'stack',
    partIndex: 2,
  })

  test('the part containing the start position, with its offset on the item timeline', async () => {
    const { play, sessions } = build({ sources: [cd1, cd2] })
    const result = await play({ startPositionMs: 1_500_000 })
    expect(result).toMatchObject({
      ok: true,
      value: {
        source: { id: 'cd2' },
        startPositionMs: 1_500_000,
        durationMs: 3_000_000,
        partOffsetMs: 1_000_000,
        parts: [
          { sourceId: 'cd1', index: 0, offsetMs: 0, durationMs: 1_000_000 },
          { sourceId: 'cd2', index: 1, offsetMs: 1_000_000, durationMs: 2_000_000 },
        ],
        versions: [
          {
            sourceId: 'cd1',
            version: { resolution: '1080p', videoCodec: 'h264' },
            selected: true,
          },
        ],
      },
    })
    // The session row keeps the item position.
    expect(sessions[0]).toMatchObject({ sourceId: 'cd2', positionMs: 1_500_000 })
  })

  test('without a position: the resume position of the profile, cumulative', async () => {
    const { play } = build({
      sources: [cd1, cd2],
      progress: [
        {
          profileId: 'profile-1',
          itemId: 'movie-1',
          positionMs: 1_200_000,
          durationMs: 3_000_000,
          watched: false,
          playCount: 0,
          lastPlayedAt: new Date(0),
          hiddenFromContinue: false,
        },
      ],
    })
    expect(await play()).toMatchObject({
      value: { source: { id: 'cd2' }, startPositionMs: 1_200_000, partOffsetMs: 1_000_000 },
    })
  })

  test('any part as sourceId selects the version; the position picks the part', async () => {
    const { play } = build({ sources: [cd1, cd2, h264] })
    expect(await play({ sourceId: 'cd2', startPositionMs: 0 })).toMatchObject({
      value: { source: { id: 'cd1' }, partOffsetMs: 0 },
    })
  })
})

describe('createPlaybackSession: transcode limit (§10.3)', () => {
  const transcoding = (id: string, extra: Partial<PlaybackSession> = {}): PlaybackSession => ({
    id,
    profileId: 'profile-2',
    authSessionId: `auth-of-${id}`,
    accountId: 'account-2',
    sourceId: 'other',
    itemId: 'other-item',
    mode: 'hls_transcode',
    burnIn: false,
    startedAt: new Date('2026-10-23T11:59:50.000Z'),
    lastHeartbeatAt: new Date('2026-10-23T11:59:50.000Z'),
    positionMs: 0,
    ...extra,
  })

  test('beyond max_concurrent_transcodes: transcode_limit_reached, nothing recorded', async () => {
    const { play, sessions } = build({
      sources: [hevc4k],
      sessions: [transcoding('t1'), transcoding('t2')],
    })
    expect(await play()).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached', context: { limit: 2 } },
    })
    expect(sessions).toHaveLength(2)
  })

  test('remux and direct sessions do not count, nor ended or expired transcodes', async () => {
    const { play } = build({
      sources: [hevc4k],
      sessions: [
        transcoding('remux', { mode: 'hls_remux' }),
        transcoding('ended', { endedAt: new Date('2026-10-23T11:59:55.000Z') }),
        transcoding('silent', { lastHeartbeatAt: new Date('2026-10-23T11:58:00.000Z') }),
        transcoding('t1'),
      ],
    })
    expect(await play()).toMatchObject({ ok: true, value: { plan: { mode: 'hls_transcode' } } })
  })

  test('the session a player replaces (same auth session, same item) does not block', async () => {
    const { play } = build({
      sources: [hevc4k],
      sessions: [
        transcoding('t1'),
        transcoding('previous', { authSessionId: 'auth-1', itemId: 'movie-1' }),
      ],
      settings: { maxConcurrentTranscodes: 1 },
    })
    expect(await play({ quality: '720p' })).toMatchObject({ ok: false })
    const alone = build({
      sources: [hevc4k],
      sessions: [transcoding('previous', { authSessionId: 'auth-1', itemId: 'movie-1' })],
      settings: { maxConcurrentTranscodes: 1 },
    })
    expect(await alone.play({ quality: '720p' })).toMatchObject({
      ok: true,
      value: { plan: { mode: 'hls_transcode', quality: '720p' } },
    })
  })

  test('only the latest session of the same auth session on the item is exempt (tabs)', async () => {
    const tab = (id: string, startedAt: string) =>
      transcoding(id, {
        authSessionId: 'auth-1',
        itemId: 'movie-1',
        startedAt: new Date(startedAt),
      })
    const { play, sessions } = build({
      sources: [hevc4k],
      sessions: [
        tab('tab-1', '2026-10-23T11:59:40.000Z'),
        tab('tab-2', '2026-10-23T11:59:50.000Z'),
      ],
      settings: { maxConcurrentTranscodes: 1 },
    })
    expect(await play()).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached' },
    })
    expect(sessions).toHaveLength(2)
  })

  test('a limit of 0 turns transcoding off; direct play still works', async () => {
    const { play } = build({ sources: [hevc4k, h264], settings: { maxConcurrentTranscodes: 0 } })
    expect(await play({ sourceId: 'hevc-4k' })).toMatchObject({
      error: { code: 'playback/transcode_limit_reached' },
    })
    expect(await play()).toMatchObject({ ok: true, value: { plan: { mode: 'direct' } } })
  })
})

describe('createPlaybackSession: tracks (§11)', () => {
  const multi = media('h264', 'aac', {
    audio: [
      { index: 1, codec: 'aac', language: 'en', isDefault: true },
      { index: 2, codec: 'ac3', language: 'fr', isDefault: false, channels: 6 },
    ],
  })
  const track = (id: string, extra: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
    id,
    sourceId: 'mkv',
    origin: 'embedded',
    forced: false,
    sdh: false,
    isDefault: false,
    format: 'srt',
    ...extra,
  })

  test('the profile cascade picks the French audio; the DTO material lists every track', async () => {
    const mkv = source('mkv', 'mkv', multi)
    const { play, sessions } = build({
      sources: [mkv],
      subtitles: { mkv: [track('fr-forced', { language: 'fr', forced: true })] },
    })
    const result = await play({ capabilities: safari })
    expect(result).toMatchObject({
      ok: true,
      value: {
        plan: { mode: 'hls_remux', audio: { stream: { index: 2 }, delivery: 'copy' } },
        tracks: { audio: { index: 2 }, subtitle: { id: 'fr-forced' }, origin: 'profile' },
        audioTracks: [
          { stream: { index: 1 }, delivery: 'copy' },
          { stream: { index: 2 }, delivery: 'copy' },
        ],
        availableQualities: ['original', '1080p', '720p', '480p'],
      },
    })
    expect(sessions[0]).toMatchObject({ audioStream: 2, subtitleTrackId: 'fr-forced' })
  })

  test('an episode reads the memory of its series, and the anime rule its genres and language', async () => {
    const episode = source('episode-file', 'mkv', {
      ...multi,
      audio: [
        { index: 1, codec: 'aac', language: 'fr', isDefault: true },
        { index: 2, codec: 'aac', language: 'ja', isDefault: false },
      ],
    })
    // The episode's own genres are empty: the series is the work (§11.1).
    const items = [
      item('show', 'series', { originalLanguage: 'ja', genres: ['animation', 'action'] }),
      item('show-s1', 'season', { parentId: 'show' }),
      item('show-s1e1', 'episode', { parentId: 'show-s1' }),
    ]
    const subtitles = {
      'episode-file': [track('fr', { language: 'fr', sourceId: 'episode-file' })],
    }
    const anime = await build({ sources: [episode], items, subtitles }).play({
      itemId: 'show-s1e1',
    })
    expect(anime).toMatchObject({
      value: { tracks: { audio: { index: 2 }, subtitle: { id: 'fr' }, origin: 'anime' } },
    })
    const remembered = await build({
      sources: [episode],
      items,
      subtitles,
      memory: [
        {
          profileId: 'profile-1',
          itemId: 'show',
          audioLanguage: 'fr',
          subtitlesEnabled: false,
          updatedAt: new Date(0),
        },
      ],
    }).play({ itemId: 'show-s1e1' })
    expect(remembered).toMatchObject({
      value: { tracks: { audio: { index: 1 }, origin: 'memory' } },
    })
    expect(remembered.ok && remembered.value.tracks.subtitle).toBeUndefined()
  })

  test('a Japanese live-action film is not an anime: the profile defaults', async () => {
    const film = source('film-file', 'mkv', {
      ...multi,
      audio: [
        { index: 1, codec: 'aac', language: 'fr', isDefault: true },
        { index: 2, codec: 'aac', language: 'ja', isDefault: false },
      ],
    })
    const subtitles = { 'film-file': [track('fr', { language: 'fr', sourceId: 'film-file' })] }
    const play = (genres: CatalogItem['genres']) =>
      build({
        sources: [film],
        items: [item('movie-1', 'movie', { originalLanguage: 'ja', genres })],
        subtitles,
      }).play({ itemId: 'movie-1' })
    const liveAction = await play(['drama', 'crime'])
    expect(liveAction).toMatchObject({
      value: { tracks: { audio: { index: 1 }, origin: 'profile' } },
    })
    expect(liveAction.ok && liveAction.value.tracks.subtitle).toBeUndefined()
    expect(await play(['animation'])).toMatchObject({
      value: { tracks: { audio: { index: 2 }, subtitle: { id: 'fr' }, origin: 'anime' } },
    })
  })

  test('a subtitle track of another part is mapped to its equivalent', async () => {
    const cd1 = source('cd1', 'mkv', multi, { stackGroupId: 's', partIndex: 1 })
    const cd2 = source('cd2', 'mkv', multi, { stackGroupId: 's', partIndex: 2 })
    const { play } = build({
      sources: [cd1, cd2],
      subtitles: {
        cd1: [track('cd1-en', { language: 'en', sourceId: 'cd1' })],
        cd2: [
          track('cd2-fr', { language: 'fr', sourceId: 'cd2' }),
          track('cd2-en', { language: 'en', sourceId: 'cd2' }),
        ],
      },
    })
    expect(
      await play({ startPositionMs: 3_600_000, subtitleTrackId: 'cd1-en', audioStreamIndex: 1 }),
    ).toMatchObject({
      value: {
        source: { id: 'cd2' },
        tracks: { audio: { index: 1 }, subtitle: { id: 'cd2-en' }, origin: 'explicit' },
      },
    })
  })

  test('a bitmap track is burnt in: transcode, recorded on the session', async () => {
    const mp4 = source('mp4', 'mp4', media('h264', 'aac'))
    const pgs = track('pgs', { language: 'fr', format: 'pgs', sourceId: 'mp4' })
    const { play, sessions } = build({ sources: [mp4], subtitles: { mp4: [pgs] } })
    expect(await play({ subtitleTrackId: 'pgs' })).toMatchObject({
      ok: true,
      value: { plan: { mode: 'hls_transcode', reasons: ['burn_in'] }, burnInEnabled: true },
    })
    expect(sessions[0]).toMatchObject({
      mode: 'hls_transcode',
      burnIn: true,
      subtitleTrackId: 'pgs',
      audioDelivery: 'aac',
    })
    const off = build({
      sources: [mp4],
      subtitles: { mp4: [pgs] },
      settings: { burnInEnabled: false },
    })
    expect(await off.play({ subtitleTrackId: 'pgs' })).toMatchObject({
      ok: false,
      error: { code: 'playback/subtitle_unsupported' },
    })
    expect(await off.play()).toMatchObject({
      ok: true,
      value: { plan: { mode: 'direct' }, burnInEnabled: false },
    })
  })
})

describe('createPlaybackSession: automatic bitmap subtitle that cannot be burnt in (§10.4)', () => {
  const frenchFile = source(
    'mp4',
    'mp4',
    media('h264', 'aac', { audio: [{ index: 1, codec: 'aac', language: 'fr', isDefault: true }] }),
  )
  const forcedPgs: SubtitleTrack = {
    id: 'pgs-forced',
    sourceId: 'mp4',
    origin: 'embedded',
    streamIndex: 2,
    language: 'fr',
    forced: true,
    sdh: false,
    isDefault: false,
    format: 'pgs',
  }
  const world = (settings: Partial<PlaybackSettings> = {}) =>
    build({ sources: [frenchFile], subtitles: { mp4: [forcedPgs] }, settings })

  test('picked by the cascade, burnt in when a transcode slot is free', async () => {
    expect(await world().play()).toMatchObject({
      ok: true,
      value: { plan: { mode: 'hls_transcode' }, tracks: { subtitle: { id: 'pgs-forced' } } },
    })
  })

  test('no transcode slot, or no HLS on the client: the session starts without it', async () => {
    for (const [settings, capabilities] of [
      [{ maxConcurrentTranscodes: 0 }, oldChrome],
      [{}, { ...oldChrome, hls: 'none' as const }],
    ] as const) {
      const { play, sessions } = world(settings)
      const result = await play({ capabilities })
      expect(result).toMatchObject({
        ok: true,
        value: { plan: { mode: 'direct' }, tracks: { burnIn: false } },
      })
      expect(result.ok && result.value.tracks.subtitle).toBeUndefined()
      expect(sessions[0]).toMatchObject({ mode: 'direct', burnIn: false })
      expect(sessions[0]).not.toHaveProperty('subtitleTrackId')
    }
  })

  test('named by the request: the error stands', async () => {
    const { play, sessions } = world({ maxConcurrentTranscodes: 0 })
    expect(await play({ subtitleTrackId: 'pgs-forced' })).toMatchObject({
      ok: false,
      error: { code: 'playback/transcode_limit_reached' },
    })
    expect(sessions).toHaveLength(0)
  })
})

describe('createPlaybackSession: multi-episode files (§8.4)', () => {
  test('the start is recorded on every episode of the file', async () => {
    const file = source('e01-e02', 'mp4', media('h264', 'aac'))
    const { play, progress } = build({
      sources: [file],
      items: [item('e1', 'episode'), item('e2', 'episode')],
      sourceItems: { 'e01-e02': ['e1', 'e2'] },
    })
    expect(await play({ itemId: 'e1', startPositionMs: 60_000 })).toMatchObject({ ok: true })
    expect([...progress.values()].map((entry) => [entry.itemId, entry.positionMs])).toEqual([
      ['e1', 60_000],
      ['e2', 60_000],
    ])
  })

  test('trickplay: ready for the played source only', async () => {
    const { play } = build({ sources: [h264] })
    expect(await play()).toMatchObject({ value: { trickplayReady: true } })
  })
})
