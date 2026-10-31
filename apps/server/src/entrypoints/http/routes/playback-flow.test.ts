import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import type { ClientCapabilities } from '@projo/shared/api/playback'

import {
  insertItem,
  insertLibrary,
  insertProfile,
  insertSource,
  seedViewer,
} from '../../../../test/support/catalog-fixtures.ts'
import { createManualClock, type ManualClock } from '../../../../test/support/clock.ts'
import { createTempDir, createTestDatabase } from '../../../../test/support/database.ts'
import {
  createRecordingEventBus,
  createRecordingJobQueue,
  createSequentialIds,
} from '../../../../test/support/fakes.ts'
import { silentLogger } from '../../../../test/support/logger.ts'
import { generateVideo, hasFfmpeg } from '../../../../test/support/media.ts'
import { dataPathsFor } from '../../../core/data-paths.ts'
import type { Db } from '../../../infrastructure/sqlite/database.ts'
import { profiles } from '../../../infrastructure/sqlite/schema/accounts.ts'
import { sourceItems, sourceSubtitles } from '../../../infrastructure/sqlite/schema/libraries.ts'
import { settings } from '../../../infrastructure/sqlite/schema/ops.ts'
import type { ServerEvent } from '../../../core/events.ts'
import type { JobContext } from '../../jobs/handler.ts'
import { allVisible, buildCatalogModule } from '../../modules/catalog.ts'
import type { Platform } from '../../modules/platform.ts'
import { buildPlaybackModule } from '../../modules/playback.ts'
import { buildProgressModule } from '../../modules/progress.ts'
import { type ApiRoutes, createApi } from '../api.ts'
import type { AppEnv } from '../context.ts'

/**
 * End to end over HTTP with real ffprobe / ffmpeg: catalog → session → stream → heartbeat →
 * resume → end. Authentication is stubbed: `x-account` selects the account (its only profile).
 */

const media = createTempDir('projo-flow-media-')
let mkvPath = ''
let mp4Path = ''
beforeAll(async () => {
  if (!hasFfmpeg()) return
  mkvPath = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'ac3',
    durationS: 30,
  })
  mp4Path = await generateVideo(media.path, {
    container: 'mp4',
    video: 'h264',
    audio: 'aac',
    durationS: 10,
  })
})
afterAll(() => media.cleanup())

const chrome: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2', 'opus'],
  hls: 'mse',
}

const unwired = <K extends keyof ApiRoutes>() => new Hono<AppEnv>() as unknown as ApiRoutes[K]

let data: ReturnType<typeof createTempDir>
let db: Db
let clock: ManualClock
let events: ServerEvent[]
let jobs: ReturnType<typeof createRecordingJobQueue>
let playback: ReturnType<typeof buildPlaybackModule>
let api: ReturnType<typeof createApi>

beforeEach(() => {
  data = createTempDir('projo-flow-data-')
  db = createTestDatabase()
  clock = createManualClock(new Date())
  const bus = createRecordingEventBus()
  events = bus.events
  jobs = createRecordingJobQueue()
  const platform = {
    db,
    clock,
    ids: createSequentialIds('ps-'),
    logger: silentLogger,
    eventBus: bus.bus,
    jobQueue: jobs.queue,
    paths: dataPathsFor(data.path),
  } as unknown as Platform

  for (const accountId of ['leo', 'intruder']) seedViewer(db, accountId)
  // A child's profile on Léo's account: unrated titles do not exist for it (§14).
  insertProfile(db, 'leo', 'profile-kid')
  insertLibrary(db, { rootPath: dirname(mkvPath || media.path) })
  insertItem(db, { id: 'mkv-movie', kind: 'movie', title: 'Big Buck', sortTitle: 'big buck' })
  insertItem(db, { id: 'mp4-movie', kind: 'movie', title: 'Small', sortTitle: 'small' })
  const size = (path: string) => (path === '' ? 1 : statSync(path).size)
  // No stored probe for the MKV: playback probes the file itself.
  insertSource(db, {
    id: 'mkv-source',
    itemId: 'mkv-movie',
    relativePath: basename(mkvPath),
    sizeBytes: size(mkvPath),
  })
  insertSource(db, {
    id: 'mp4-source',
    itemId: 'mp4-movie',
    relativePath: basename(mp4Path),
    extension: 'mp4',
    sizeBytes: size(mp4Path),
  })

  const scopes = (profileId: string) =>
    profileId === 'profile-kid' ? { allowedRatings: { FR: ['TP'] } } : {}
  playback = buildPlaybackModule(platform, { visibilityScope: scopes })
  const catalog = buildCatalogModule(platform, { visibilityScope: allVisible })
  const progress = buildProgressModule(platform, { visibilityScope: allVisible })
  api = createApi({
    middleware: {
      authenticate: async (c, next) => {
        const accountId = c.req.header('x-account')
        if (accountId !== undefined) {
          c.set('account', { id: accountId, username: accountId, role: 'admin' })
          c.set('session', { id: `session-of-${accountId}`, accountId, kind: 'cookie' })
          c.set('profileId', c.req.header('x-profile') ?? `profile-of-${accountId}`)
        }
        await next()
      },
      requireAdmin: async (_c, next) => {
        await next()
      },
    },
    routes: {
      setup: unwired<'setup'>(),
      auth: unwired<'auth'>(),
      invitations: unwired<'invitations'>(),
      profiles: unwired<'profiles'>(),
      events: unwired<'events'>(),
      catalog: catalog.routes,
      home: catalog.homeRoutes,
      search: catalog.searchRoutes,
      progress: progress.routes,
      watchlist: progress.watchlistRoutes,
      playback: playback.routes,
      stream: playback.streamRoutes,
      adminLibraries: unwired<'adminLibraries'>(),
      adminFs: unwired<'adminFs'>(),
      adminSources: unwired<'adminSources'>(),
      images: unwired<'images'>(),
      adminSourceReview: unwired<'adminSourceReview'>(),
      adminItems: unwired<'adminItems'>(),
      adminSettings: unwired<'adminSettings'>(),
      adminAccounts: unwired<'adminAccounts'>(),
      adminProfiles: unwired<'adminProfiles'>(),
      subtitles: unwired<'subtitles'>(),
      trickplay: unwired<'trickplay'>(),
      previews: unwired<'previews'>(),
      segments: unwired<'segments'>(),
      adminSegments: unwired<'adminSegments'>(),
      adminPlayback: unwired<'adminPlayback'>(),
      adminMissingSources: unwired<'adminMissingSources'>(),
      adminJobs: unwired<'adminJobs'>(),
      adminNotifications: unwired<'adminNotifications'>(),
      adminSystem: unwired<'adminSystem'>(),
      adminUpdates: unwired<'adminUpdates'>(),
    },
  })
})

afterEach(async () => {
  await playback.stop()
  data.cleanup()
})

const call = (path: string, init: RequestInit & { as?: string; json?: unknown } = {}) => {
  const { as = 'leo', json, ...rest } = init
  return api.request(path, {
    ...rest,
    headers: {
      'x-account': as,
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...(rest.headers as Record<string, string> | undefined),
    },
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  })
}

const body = async <T = Record<string, unknown>>(response: Response) => (await response.json()) as T

const runQueuedKeyframeJobs = async () => {
  const handler = playback.jobHandlers.index_keyframes
  for (const job of jobs.enqueued.filter((entry) => entry.type === 'index_keyframes')) {
    const result = await handler.run(job.payload, {
      signal: new AbortController().signal,
      job: { priority: job.priority ?? 0 },
    } as unknown as JobContext)
    expect(result.ok).toBe(true)
  }
}

describe.skipIf(!hasFfmpeg())('playback over HTTP', () => {
  test('MKV in Chrome: HLS remux, segments, heartbeat, resume, end', async () => {
    const created = await call('/playback/sessions', {
      method: 'POST',
      json: { itemId: 'mkv-movie', capabilities: chrome },
    })
    expect(created.status).toBe(201)
    const session = await body<{
      id: string
      mode: string
      stream: { type: string; url: string }
      startPositionMs: number
      audioTracks: { index: number; codec: string; delivery?: string }[]
    }>(created)
    expect(session).toMatchObject({
      mode: 'hls_remux',
      stream: { type: 'hls' },
      startPositionMs: 0,
      heartbeatIntervalMs: 10_000,
      audioTracks: [{ index: 1, codec: 'ac3', delivery: 'aac' }],
      subtitleTracks: [],
    })
    // §18: the keyframe index is requested at once, interactive priority.
    expect(jobs.enqueued).toEqual([
      {
        type: 'index_keyframes',
        payload: { sourceId: 'mkv-source' },
        dedupeKey: 'keyframes:mkv-source',
        priority: 100,
      },
    ])
    await runQueuedKeyframeJobs()
    expect(existsSync(`${data.path}/cache/keyframes/mkv-source.json`)).toBe(true)

    // §20: under the session's capability prefix, a 256-bit secret in base64url.
    expect(session.stream.url).toMatch(
      new RegExp(`^/api/v1/stream/${session.id}/[\\w-]{43}/index\\.m3u8$`),
    )
    const playlistPath = session.stream.url.replace('/api/v1', '')
    const playlist = await call(playlistPath)
    expect(playlist.status).toBe(200)
    expect(playlist.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
    const text = await playlist.text()
    expect(text).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(text.match(/seg-\d+\.m4s/g)).toHaveLength(5)

    const base = playlistPath.replace('index.m3u8', '')
    const init = await call(`${base}init.mp4`)
    const segment = await call(`${base}seg-00002.m4s`)
    expect([init.status, segment.status]).toEqual([200, 200])
    expect(segment.headers.get('content-type')).toBe('video/mp4')
    expect((await segment.arrayBuffer()).byteLength).toBeGreaterThan(1000)
    expect((await call(`${base}seg-00099.m4s`)).status).toBe(404)
    expect((await call(`${base}../../etc`)).status).toBe(404)
    // §20: the secret is the credential, whoever asks; a wrong one names no session.
    expect((await call(playlistPath, { as: 'intruder' })).status).toBe(200)
    expect((await call(playlistPath.replace(/\/[^/]+\/index/, '/wrong/index'))).status).toBe(404)

    clock.advance(10_000)
    const beat = await call(`/playback/sessions/${session.id}/heartbeat`, {
      method: 'PUT',
      json: { positionMs: 12_000 },
    })
    expect(await body(beat)).toEqual({ sessionId: session.id, positionMs: 12_000, watched: false })
    const item = await body(await call('/items/mkv-movie'))
    expect(item).toMatchObject({
      progress: { state: 'in_progress', positionMs: 12_000, resumePositionMs: 12_000 },
      sources: [{ id: 'mkv-source', container: 'mkv' }],
    })

    const stopped = await call(`/playback/sessions/${session.id}`, { method: 'DELETE' })
    expect(stopped.status).toBe(200)
    expect(events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: session.id, sessionId: 'session-of-leo', reason: 'ended' },
    })
    const late = await call(`/playback/sessions/${session.id}/heartbeat`, {
      method: 'PUT',
      json: { positionMs: 13_000 },
    })
    expect(late.status).toBe(410)
    expect((await call(playlistPath)).status).toBe(410)

    // Reopening resumes where the profile was.
    const resumed = await body(
      await call('/playback/sessions', {
        method: 'POST',
        json: { itemId: 'mkv-movie', capabilities: chrome },
      }),
    )
    expect(resumed).toMatchObject({ startPositionMs: 12_000 })
  })

  test('a subtitle rendition of master.m3u8 lasts as long as the video playlist (§10.4)', async () => {
    db.insert(sourceSubtitles)
      .values({
        id: 'mkv-fr',
        sourceId: 'mkv-source',
        kind: 'external',
        path: '/media/mkv.fr.srt',
        language: 'fr',
        format: 'srt',
      })
      .run()
    const session = await body<{ stream: { url: string } }>(
      await call('/playback/sessions', {
        method: 'POST',
        json: {
          itemId: 'mkv-movie',
          subtitleTrackId: 'mkv-fr',
          capabilities: { ...chrome, hls: 'native', subtitleDelivery: 'hls' },
        },
      }),
    )
    await runQueuedKeyframeJobs()
    const base = session.stream.url.replace('/api/v1', '').replace('master.m3u8', '')
    const seconds = (playlist: string) =>
      [...playlist.matchAll(/#EXTINF:([\d.]+),/g)].reduce((sum, [, s]) => sum + Number(s), 0)
    const video = await (await call(`${base}index.m3u8`)).text()
    const rendition = await call(`${base}subtitles/mkv-fr.m3u8?subtitleOffsetMs=250`)
    expect(rendition.status).toBe(200)
    const text = await rendition.text()
    expect(text).toContain('\nmkv-fr.vtt?subtitleOffsetMs=250\n')
    expect(seconds(text)).toBeCloseTo(seconds(video), 3)
    expect((await call(`${base}subtitles/nope.m3u8`)).status).toBe(404)
  })

  test('a deleted profile or account: its sessions end cleanly first (§10.6, §14)', async () => {
    const created = await body<{ id: string; stream: { url: string } }>(
      await call('/playback/sessions', {
        method: 'POST',
        json: { itemId: 'mkv-movie', capabilities: chrome },
      }),
    )
    const theirs = await body<{ id: string }>(
      await call('/playback/sessions', {
        method: 'POST',
        as: 'intruder',
        json: { itemId: 'mp4-movie', capabilities: chrome },
      }),
    )
    playback.playbackSessions.endWithin({ profileIds: ['profile-of-leo'] })
    expect(events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: created.id, sessionId: 'session-of-leo', reason: 'admin' },
    })
    expect((await call(created.stream.url.replace('/api/v1', ''))).status).toBe(410)
    // The other account plays on, until its own account goes.
    const beat = await call(`/playback/sessions/${theirs.id}/heartbeat`, {
      method: 'PUT',
      as: 'intruder',
      json: { positionMs: 1_000 },
    })
    expect(beat.status).toBe(200)
    playback.playbackSessions.endWithin({ accountId: 'intruder' })
    expect(events).toContainEqual({
      type: 'playback.session_terminated',
      payload: { playbackSessionId: theirs.id, sessionId: 'session-of-intruder', reason: 'admin' },
    })
  })

  test('MP4 in Chrome: direct play with HTTP Range, bound to the session', async () => {
    const session = await body<{
      id: string
      mode: string
      stream: { url: string; mimeType: string }
    }>(
      await call('/playback/sessions', {
        method: 'POST',
        json: { itemId: 'mp4-movie', capabilities: chrome },
      }),
    )
    expect(session).toMatchObject({
      mode: 'direct',
      stream: { type: 'direct', mimeType: 'video/mp4' },
    })
    expect(jobs.enqueued).toEqual([])
    const url = session.stream.url.replace('/api/v1', '')
    const file = readFileSync(mp4Path)

    const partial = await call(url, { headers: { range: 'bytes=100-199' } })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 100-199/${file.length}`)
    expect(partial.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await partial.arrayBuffer()).equals(file.subarray(100, 200))).toBe(true)

    const tail = await call(url, { headers: { range: 'bytes=-10' } })
    expect(Buffer.from(await tail.arrayBuffer()).equals(file.subarray(file.length - 10))).toBe(true)

    const full = await call(url)
    expect(full.status).toBe(200)
    expect(full.headers.get('content-length')).toBe(String(file.length))

    const outside = await call(url, { headers: { range: `bytes=${file.length}-` } })
    expect(outside.status).toBe(416)
    expect(outside.headers.get('content-range')).toBe(`bytes */${file.length}`)

    expect((await call(url.replace(/\/[^/]+\/direct$/, '/wrong/direct'))).status).toBe(404)
    expect((await call(url.replace('/direct', '/index.m3u8'))).status).toBe(422)

    // `navigator.sendBeacon(url, JSON.stringify(body))` on page close: POST in text/plain.
    const beacon = (text: string) =>
      call(`/playback/sessions/${session.id}/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
        body: text,
      })
    const beaconed = await beacon(JSON.stringify({ positionMs: 4_000 }))
    expect(beaconed.status).toBe(200)
    expect(await body(beaconed)).toMatchObject({ sessionId: session.id, positionMs: 4_000 })
    for (const invalid of ['{not json', JSON.stringify({ positionMs: -1 })]) {
      const rejected = await beacon(invalid)
      expect(rejected.status).toBe(400)
      expect(await body(rejected)).toMatchObject({ error: { code: 'common/validation_failed' } })
    }

    // 60 s without heartbeat: the URL stops working.
    clock.advance(60_000)
    expect((await call(url)).status).toBe(410)
  })

  test('another profile of the account cannot use a session on a title it does not see', async () => {
    const session = await body<{ id: string; stream: { url: string } }>(
      await call('/playback/sessions', {
        method: 'POST',
        json: { itemId: 'mp4-movie', capabilities: chrome },
      }),
    )
    const url = session.stream.url.replace('/api/v1', '')
    const kid = { 'x-profile': 'profile-kid' }
    const beat = await call(`/playback/sessions/${session.id}/heartbeat`, {
      method: 'PUT',
      headers: kid,
      json: { positionMs: 1_000 },
    })
    expect(beat.status).toBe(404)
    expect((await call(url)).status).toBe(200)
  })

  test('a video codec the client lacks: HLS transcode, audio in AAC (§10.2)', async () => {
    const response = await call('/playback/sessions', {
      method: 'POST',
      json: {
        itemId: 'mkv-movie',
        capabilities: { videoCodecs: ['vp09'], audioCodecs: [], hls: 'mse' },
      },
    })
    expect(response.status).toBe(201)
    expect(await body(response)).toMatchObject({
      mode: 'hls_transcode',
      quality: 'original',
      stream: { type: 'hls' },
      audioTracks: [{ index: 1, codec: 'ac3', delivery: 'aac' }],
      burnIn: false,
    })
  })
})

/** A stored probe (normalized shape) of an MP4 with H.264 video. */
const storedProbe = ({
  durationMs,
  audio = [{ index: 1, codec_type: 'audio', codec_name: 'aac', disposition: { default: 1 } }],
  chapters = [],
}: {
  durationMs: number
  audio?: Record<string, unknown>[]
  chapters?: Record<string, unknown>[]
}) => ({
  durationMs,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      pix_fmt: 'yuv420p',
    },
    ...audio,
  ],
  chapters,
})

describe('tracks, memory, parts and multi-episode files over HTTP (§7.7, §8.4, §11)', () => {
  const play = async (json: Record<string, unknown>, as?: string) => {
    const response = await call('/playback/sessions', {
      method: 'POST',
      json: { capabilities: chrome, ...json },
      ...(as === undefined ? {} : { as }),
    })
    return { status: response.status, session: await body(response) }
  }

  const seedAnime = () => {
    // §11.1 defaults of a new profile (the fixture row has the column defaults).
    db.update(profiles)
      .set({ animeOriginalAudio: true })
      .where(eq(profiles.id, 'profile-of-leo'))
      .run()
    // An anime (§11.1): genre animation and Japanese, on the series only.
    insertItem(db, {
      id: 'anime',
      kind: 'series',
      originalLanguage: 'ja',
      genres: ['animation', 'action'],
    })
    insertItem(db, { id: 'anime-s1', kind: 'season', parentId: 'anime', seasonNumber: 1 })
    for (const n of [1, 2]) {
      insertItem(db, {
        id: `a${n}`,
        kind: 'episode',
        parentId: 'anime-s1',
        seasonNumber: 1,
        episodeNumber: n,
      })
      insertSource(db, {
        id: `a${n}-file`,
        itemId: `a${n}`,
        extension: 'mp4',
        probe: storedProbe({
          durationMs: 1_440_000,
          audio: [
            {
              index: 1,
              codec_type: 'audio',
              codec_name: 'aac',
              tags: { language: 'fre' },
              disposition: { default: 1 },
            },
            { index: 2, codec_type: 'audio', codec_name: 'aac', tags: { language: 'jpn' } },
          ],
          chapters: [{ start_time: '0', end_time: '90.5', tags: { title: 'Opening' } }],
        }),
      })
      db.insert(sourceSubtitles)
        .values([
          {
            id: `a${n}-fr`,
            sourceId: `a${n}-file`,
            kind: 'external',
            path: `/media/a${n}.fr.srt`,
            language: 'fr',
            format: 'srt',
          },
          {
            id: `a${n}-pgs`,
            sourceId: `a${n}-file`,
            kind: 'embedded',
            streamIndex: 3,
            language: 'en',
            format: 'pgs',
          },
        ])
        .run()
    }
  }

  test('subtitles inside the stream for an iOS client: remux and master.m3u8 (§10.4, §20)', async () => {
    seedAnime()
    const tracks = { itemId: 'a1', audioStreamIndex: 1, subtitleTrackId: 'a1-fr' }
    // A browser drawing the subtitles itself plays the MP4 as is.
    expect((await play(tracks)).session).toMatchObject({ mode: 'direct' })

    const ios = { ...chrome, hls: 'native', subtitleDelivery: 'hls' }
    const { session } = await play({ ...tracks, capabilities: ios })
    expect(session).toMatchObject({ mode: 'hls_remux', selectedSubtitleTrackId: 'a1-fr' })
    const url = (session.stream as { url: string }).url.replace('/api/v1', '')
    expect(url).toMatch(/\/master\.m3u8$/)
    // The secret is enough: AVPlayer and AirPlay receivers send no cookie.
    const master = await call(url, { as: 'airplay' })
    expect(master.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
    const text = await master.text()
    expect(text).toContain(
      'NAME="fr",LANGUAGE="fr",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,URI="subtitles/a1-fr.m3u8?subtitleOffsetMs=0"',
    )
    expect(text).not.toContain('a1-pgs')
    expect(text).toContain('SUBTITLES="subs"\nindex.m3u8')
    expect(await (await call(`${url}?subtitleOffsetMs=750`)).text()).toContain(
      'subtitleOffsetMs=750',
    )
    expect((await call(`${url}?subtitleOffsetMs=60000`)).status).toBe(400)
  })

  test('the cascade, the series memory, PUT / DELETE track-preferences', async () => {
    seedAnime()
    const first = await play({ itemId: 'a1' })
    expect(first.status).toBe(201)
    expect(first.session).toMatchObject({
      mode: 'hls_remux',
      trackSelection: 'anime',
      selectedAudioStreamIndex: 2,
      selectedSubtitleTrackId: 'a1-fr',
      burnIn: false,
      subtitleTracks: [
        {
          id: 'a1-fr',
          origin: 'external',
          format: 'srt',
          language: 'fr',
          delivery: 'vtt',
          url: '/api/v1/subtitles/a1-file/a1-fr.vtt',
        },
        { id: 'a1-pgs', origin: 'embedded', format: 'pgs', delivery: 'burn_in' },
      ],
      chapters: [{ startMs: 0, endMs: 90_500, title: 'Opening' }],
      versions: [{ sourceId: 'a1-file', selected: true }],
      parts: [{ sourceId: 'a1-file', index: 0, offsetMs: 0, durationMs: 1_440_000 }],
      partOffsetMs: 0,
      availableQualities: ['original', '1080p', '720p', '480p'],
    })
    expect(first.session).not.toHaveProperty('trickplayUrl')

    // "Applied to the whole show": stored on the series.
    const saved = await call('/items/a1/track-preferences', {
      method: 'PUT',
      json: { audioLanguage: 'fr', subtitlesEnabled: false },
    })
    expect(saved.status).toBe(200)
    expect(await body(saved)).toMatchObject({
      itemId: 'anime',
      audioLanguage: 'fr',
      subtitlesEnabled: false,
    })
    const next = await play({ itemId: 'a2' })
    expect(next.session).toMatchObject({
      mode: 'direct',
      trackSelection: 'memory',
      selectedAudioStreamIndex: 1,
    })
    expect(next.session).not.toHaveProperty('selectedSubtitleTrackId')

    // An explicit choice wins, a burnt-in bitmap track forces a transcode.
    expect(
      (await play({ itemId: 'a2', audioStreamIndex: 2, subtitleTrackId: 'a2-pgs' })).session,
    ).toMatchObject({
      mode: 'hls_transcode',
      trackSelection: 'explicit',
      selectedSubtitleTrackId: 'a2-pgs',
      burnIn: true,
    })

    // "Undo": the memory is gone, the anime rule is back.
    const cleared = await call('/items/a2/track-preferences', { method: 'DELETE' })
    expect(cleared.status).toBe(204)
    expect((await call('/items/a2/track-preferences', { method: 'DELETE' })).status).toBe(204)
    expect((await play({ itemId: 'a2' })).session).toMatchObject({ trackSelection: 'anime' })

    // Burn-in turned off (§10.4): bitmap tracks are listed as unsupported, refused if asked.
    db.insert(settings)
      .values({
        key: 'playback.burn_in_enabled',
        value: false,
        updatedAt: new Date().toISOString(),
      })
      .run()
    const refused = await play({ itemId: 'a2', subtitleTrackId: 'a2-pgs' })
    expect(refused).toMatchObject({
      status: 422,
      session: { error: { code: 'playback/subtitle_unsupported' } },
    })
    expect((await play({ itemId: 'a2' })).session).toMatchObject({
      subtitleTracks: [{ delivery: 'vtt' }, { id: 'a2-pgs', delivery: 'unsupported' }],
    })
  })

  test('track-preferences: only movies and episodes the profile sees', async () => {
    seedAnime()
    const put = (itemId: string, headers: Record<string, string> = {}) =>
      call(`/items/${itemId}/track-preferences`, {
        method: 'PUT',
        headers,
        json: { subtitlesEnabled: true },
      })
    expect((await put('anime')).status).toBe(400)
    expect((await put('unknown')).status).toBe(404)
    // Unrated: does not exist for the child's profile (§14).
    expect((await put('a1', { 'x-profile': 'profile-kid' })).status).toBe(404)
    expect(
      (
        await call('/items/a1/track-preferences', {
          method: 'DELETE',
          headers: { 'x-profile': 'profile-kid' },
        })
      ).status,
    ).toBe(404)
    expect((await put('mp4-movie')).status).toBe(200)
  })

  test('a movie in parts: the part of the position, offsets, cumulative progress', async () => {
    insertItem(db, { id: 'stacked', kind: 'movie' })
    for (const [n, durationMs] of [
      [1, 1_000_000],
      [2, 2_000_000],
    ] as const) {
      insertSource(db, {
        id: `cd${n}`,
        itemId: 'stacked',
        extension: 'mp4',
        stackGroupId: 'library-1-root|stacked',
        partIndex: n,
        parsed: { title: 'Stacked', edition: 'extended' },
        probe: storedProbe({ durationMs }),
      })
    }
    const { session } = await play({ itemId: 'stacked', startPositionMs: 1_500_000 })
    expect(session).toMatchObject({
      sourceId: 'cd2',
      mode: 'direct',
      stream: { url: expect.stringMatching(/\/direct$/) },
      durationMs: 3_000_000,
      startPositionMs: 1_500_000,
      partOffsetMs: 1_000_000,
      versions: [
        {
          sourceId: 'cd1',
          version: { resolution: '1080p', videoCodec: 'h264', edition: 'extended' },
          selected: true,
        },
      ],
      parts: [
        { sourceId: 'cd1', index: 0, offsetMs: 0, durationMs: 1_000_000 },
        { sourceId: 'cd2', index: 1, offsetMs: 1_000_000, durationMs: 2_000_000 },
      ],
    })
    const beat = await call(`/playback/sessions/${String(session.id)}/heartbeat`, {
      method: 'PUT',
      json: { positionMs: 2_900_000 },
    })
    expect(await body(beat)).toMatchObject({ positionMs: 2_900_000, watched: true })
    expect(await body(await call('/items/stacked'))).toMatchObject({
      progress: { state: 'watched', watched: true },
    })
  })

  test('a two-episode file: progress and "vu" on both episodes', async () => {
    insertItem(db, { id: 'show', kind: 'series' })
    insertItem(db, { id: 'show-s1', kind: 'season', parentId: 'show', seasonNumber: 1 })
    for (const n of [1, 2]) {
      insertItem(db, { id: `e${n}`, kind: 'episode', parentId: 'show-s1', episodeNumber: n })
    }
    insertSource(db, {
      id: 'e01-e02',
      itemId: 'e1',
      extension: 'mp4',
      probe: storedProbe({ durationMs: 2_400_000 }),
    })
    db.insert(sourceItems).values({ sourceId: 'e01-e02', itemId: 'e2' }).run()
    const { session } = await play({ itemId: 'e1' })
    await call(`/playback/sessions/${String(session.id)}/heartbeat`, {
      method: 'PUT',
      json: { positionMs: 600_000 },
    })
    expect(await body(await call('/items/e2'))).toMatchObject({
      progress: { state: 'in_progress', positionMs: 600_000 },
    })
    await call(`/playback/sessions/${String(session.id)}/heartbeat`, {
      method: 'PUT',
      json: { positionMs: 2_300_000 },
    })
    for (const id of ['e1', 'e2']) {
      expect(await body(await call(`/items/${id}`))).toMatchObject({
        progress: { state: 'watched', watched: true },
      })
    }
  })
})

describe('catalog and progress over HTTP', () => {
  test('lists, details, children and watched marks', async () => {
    const movies = await body<{ items: { id: string }[]; nextCursor?: string }>(
      await call('/movies?limit=1'),
    )
    expect(movies.items.map((item) => item.id)).toEqual(['mkv-movie'])
    const next = await body<{ items: { id: string }[]; nextCursor?: string }>(
      await call(`/movies?limit=1&cursor=${movies.nextCursor ?? ''}`),
    )
    expect(next).toEqual({
      items: [
        expect.objectContaining({
          id: 'mp4-movie',
          progress: expect.objectContaining({ state: 'unwatched' }),
        }),
      ],
    })
    expect((await call(`/movies?sort=added&cursor=${movies.nextCursor ?? ''}`)).status).toBe(400)
    expect((await call('/items/unknown')).status).toBe(404)
    expect((await call('/items/mkv-movie/children')).status).toBe(400)

    const progress = await call('/items/mkv-movie/progress', {
      method: 'PUT',
      json: { positionMs: 28_000, durationMs: 30_000 },
    })
    expect(await body(progress)).toMatchObject({
      itemId: 'mkv-movie',
      progress: { state: 'watched', watched: true, playCount: 1, resumePositionMs: 0 },
    })
    const unwatched = await call('/items/mkv-movie/watched', { method: 'DELETE' })
    expect(await body(unwatched)).toMatchObject({ progress: { state: 'unwatched', positionMs: 0 } })
  })

  test('series: seasons, episodes, watch status derived from episodes', async () => {
    insertItem(db, { id: 'show', kind: 'series', title: 'Show', sortTitle: 'show' })
    insertItem(db, {
      id: 'show-s1',
      kind: 'season',
      parentId: 'show',
      title: 'Saison 1',
      seasonNumber: 1,
    })
    for (const n of [1, 2]) {
      insertItem(db, {
        id: `e${n}`,
        kind: 'episode',
        parentId: 'show-s1',
        seasonNumber: 1,
        episodeNumber: n,
      })
      insertSource(db, {
        id: `e${n}-file`,
        itemId: `e${n}`,
        ...(n === 1
          ? {
              probe: {
                format: { duration: '1320.2' },
                streams: [{ index: 0, codec_type: 'video', codec_name: 'h264' }],
              },
            }
          : {}),
      })
    }
    expect(
      (await body<{ items: { id: string }[] }>(await call('/series'))).items.map((i) => i.id),
    ).toEqual(['show'])
    expect(await body(await call('/items/show/children'))).toMatchObject({
      items: [{ id: 'show-s1', watchStatus: { state: 'unwatched', totalCount: 2 } }],
    })
    // No TMDB runtime: the probed duration of the best ready source.
    const episodes = await body<{ items: { id: string; durationMs?: number }[] }>(
      await call('/items/show-s1/children'),
    )
    expect(episodes.items.map((item) => [item.id, item.durationMs])).toEqual([
      ['e1', 1_320_200],
      ['e2', undefined],
    ])
    expect(await body(await call('/items/e1'))).toMatchObject({ durationMs: 1_320_200 })
    await call('/items/e1/watched', { method: 'POST' })
    expect(await body(await call('/items/e2'))).toMatchObject({
      kind: 'episode',
      series: { id: 'show', kind: 'series' },
      season: { id: 'show-s1', seasonNumber: 1 },
      progress: { state: 'unwatched' },
    })
    expect(await body(await call('/items/show'))).toMatchObject({
      watchStatus: { state: 'partial', watchedCount: 1, totalCount: 2 },
      sources: [],
    })
    expect(await body(await call('/items/show-s1/watched', { method: 'POST' }))).toMatchObject({
      watchStatus: { state: 'watched', watchedCount: 2 },
    })
    expect(await body(await call('/items/show/watched', { method: 'DELETE' }))).toMatchObject({
      watchStatus: { state: 'unwatched', watchedCount: 0 },
    })
  })
})
