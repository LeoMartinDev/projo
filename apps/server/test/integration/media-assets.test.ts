import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'

import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { appError, err, ok } from '@projo/shared'
import { trickplayIndexDtoSchema } from '@projo/shared/api/playback'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { ServerEvent } from '../../src/core/events.ts'
import type { JobRepository } from '../../src/core/jobs/ports.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import type { JobContext, JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { trickplayUrlFactory } from '../../src/application/playback/trickplay.ts'
import { buildMediaAssetsModule } from '../../src/entrypoints/modules/media-assets.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { createFfprobeProber } from '../../src/infrastructure/media/ffprobe.ts'
import type { Db } from '../../src/infrastructure/sqlite/database.ts'
import { createTrickplayStore } from '../../src/infrastructure/playback/trickplay-store.ts'
import { createSqliteCatalogRepository } from '../../src/infrastructure/sqlite/catalog-repository.ts'
import { createSqliteJobRepository } from '../../src/infrastructure/sqlite/job-repository.ts'
import {
  libraries,
  sources,
  sourceSubtitles,
} from '../../src/infrastructure/sqlite/schema/libraries.ts'
import { settings } from '../../src/infrastructure/sqlite/schema/ops.ts'
import { writePgs } from '../support/bitmap-subtitles.ts'
import {
  insertItem,
  insertLibrary,
  insertProfile,
  insertSource,
  seedViewer,
} from '../support/catalog-fixtures.ts'
import { createManualClock } from '../support/clock.ts'
import { createTempDir, createTestDatabase } from '../support/database.ts'
import {
  createRecordingEventBus,
  createRecordingJobQueue,
  createSequentialIds,
} from '../support/fakes.ts'
import { silentLogger } from '../support/logger.ts'
import { generateVideo, hasFfmpeg, hasFfmpegEncoder } from '../support/media.ts'
import { videoWithEmbeddedSubtitles } from '../support/media-fixtures.ts'

/**
 * §10.4 subtitles, §10.5 trickplay, §13.3 previews over HTTP, with real ffmpeg / ffprobe and the
 * module's job handlers run by hand. Authentication is stubbed: `x-profile` is the active profile
 * (the auth session's last one for `<track>`, `<img>`, `<video>`).
 */

const latin1 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)))

const media = createTempDir('projo-assets-media-')
const files = { movie: '', subs: '', episode: '', srt: '', pgs: '' }
const probes: Record<string, unknown> = {}

beforeAll(async () => {
  if (!hasFfmpeg()) return
  files.movie = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'aac',
    durationS: 30,
  })
  files.episode = await generateVideo(media.path, {
    container: 'mp4',
    video: 'h264',
    audio: 'aac',
    durationS: 24,
  })
  files.subs = join(media.path, 'with-subs.mkv')
  copyFileSync(videoWithEmbeddedSubtitles(), files.subs)
  files.srt = join(media.path, 'Film.fr.srt')
  writeFileSync(files.srt, latin1('1\r\n00:00:01,000 --> 00:00:02,000\r\nÉté, déjà là\r\n'))
  files.pgs = writePgs(media.path, 'Film.en.sup', { width: 160, height: 90 }, [
    { startS: 1, endS: 2, x: 10, y: 10, width: 20, height: 10 },
  ])
  const prober = createFfprobeProber()
  for (const path of [files.movie, files.episode, files.subs]) {
    const probe = await prober.probe({ path })
    if (!probe.ok) throw new Error(`probe failed: ${probe.error.message}`)
    probes[path] = probe.value
  }
})
afterAll(() => media.cleanup())

let data: ReturnType<typeof createTempDir>
let db: Db
let events: ServerEvent[]
let publish: Platform['eventBus']['publish']
let jobs: ReturnType<typeof createRecordingJobQueue>
let jobRepository: JobRepository
let assets: ReturnType<typeof buildMediaAssetsModule>
let app: Hono<AppEnv>

const source = (id: string, path: string, itemId: string, extension = 'mkv') =>
  insertSource(db, {
    id,
    itemId,
    relativePath: basename(path),
    extension,
    sizeBytes: statSync(path).size,
    mtime: statSync(path).mtimeMs,
    probe: probes[path],
  })

beforeEach(() => {
  if (!hasFfmpeg()) return
  data = createTempDir('projo-assets-data-')
  db = createTestDatabase()
  const bus = createRecordingEventBus()
  events = bus.events
  publish = bus.bus.publish
  jobs = createRecordingJobQueue()
  jobRepository = createSqliteJobRepository({ db })
  const platform = {
    db,
    clock: createManualClock(new Date()),
    ids: createSequentialIds('asset-'),
    logger: silentLogger,
    eventBus: bus.bus,
    jobQueue: jobs.queue,
    jobRepository,
    paths: dataPathsFor(data.path),
  } as unknown as Platform

  seedViewer(db, 'leo')
  // A profile without access to the library (§14): nothing of it exists for it.
  insertProfile(db, 'leo', 'profile-kid')
  insertLibrary(db, { rootPath: media.path })
  insertItem(db, { id: 'movie', kind: 'movie' })
  insertItem(db, { id: 'movie-subs', kind: 'movie' })
  insertItem(db, { id: 'series', kind: 'series' })
  insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 1 })
  insertItem(db, { id: 'episode', kind: 'episode', parentId: 'season', episodeNumber: 1 })
  source('source-movie', files.movie, 'movie')
  source('source-subs', files.subs, 'movie-subs')
  source('source-episode', files.episode, 'episode', 'mp4')
  db.insert(sourceSubtitles)
    .values([
      {
        id: 'track-fr',
        sourceId: 'source-movie',
        kind: 'external',
        path: files.srt,
        language: 'fr',
        format: 'srt',
      },
      {
        id: 'track-pgs',
        sourceId: 'source-movie',
        kind: 'external',
        path: files.pgs,
        language: 'en',
        format: 'pgs',
      },
      {
        id: 'track-embedded',
        sourceId: 'source-subs',
        kind: 'embedded',
        streamIndex: 2,
        format: 'srt',
      },
    ])
    .run()

  const scopes = (profileId: string) => (profileId === 'profile-kid' ? { libraryIds: [] } : {})
  assets = buildMediaAssetsModule(
    platform,
    {
      visibilityScope: scopes,
      // One playback session, on `source-movie`, reached by its capability URL (§20).
      authorizeStream: ({ sessionId, secret }) =>
        sessionId === 'session-1' && secret === 'secret-1'
          ? ok({
              id: 'session-1',
              profileId: 'profile-of-leo',
              authSessionId: 'session-of-leo',
              accountId: 'leo',
              sourceId: 'source-movie',
              itemId: 'movie',
              mode: 'hls_remux',
              burnIn: false,
              startedAt: new Date(0),
              lastHeartbeatAt: new Date(0),
              positionMs: 0,
            })
          : err(
              appError('playback/session_not_found', 'no playback session', {
                context: { sessionId },
              }),
            ),
    },
    { cores: 8 },
  )
  app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('account', { id: 'leo', username: 'leo', role: 'admin' })
      c.set('session', { id: 'session-of-leo', accountId: 'leo', kind: 'cookie' })
      c.set('profileId', c.req.header('x-profile') ?? 'profile-of-leo')
      await next()
    })
    .route('/', assets.routes.subtitles)
    .route('/', assets.routes.trickplay)
    .route('/', assets.routes.previews)
})

afterEach(() => {
  if (!hasFfmpeg()) return
  assets.stop()
  data.cleanup()
})

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })
const kid = { 'x-profile': 'profile-kid' }
const codeOf = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code

const run = async (handler: JobHandler | undefined, payload: unknown) => {
  if (handler === undefined) throw new Error('no handler')
  return handler.run(payload, { signal: new AbortController().signal } as unknown as JobContext)
}

describe.skipIf(!hasFfmpeg())('subtitles (§10.4)', () => {
  test('an external Latin-1 SRT is served as UTF-8 WebVTT', async () => {
    const response = await get('/subtitles/source-movie/track-fr.vtt')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
    const text = await response.text()
    expect(text.startsWith('WEBVTT')).toBe(true)
    expect(text).toContain('Été, déjà là')
    expect(existsSync(join(data.path, 'cache/subtitles/source-movie/track-fr.vtt'))).toBe(true)
  })

  test('a rendition of master.m3u8: under the capability URL, mapped on the HLS timeline', async () => {
    const plain = new Hono<AppEnv>().route('/', assets.routes.subtitles)
    const response = await plain.request(
      '/stream/session-1/secret-1/subtitles/track-fr.vtt?subtitleOffsetMs=500',
    )
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toStartWith('WEBVTT')
    expect(text).toContain('\nX-TIMESTAMP-MAP=MPEGTS:945000,LOCAL:00:00:00.000\n')
    expect(text).toContain('Été, déjà là')
    const wrong = await plain.request('/stream/session-1/nope/subtitles/track-fr.vtt')
    expect(wrong.status).toBe(404)
  })

  test('an embedded text track is extracted', async () => {
    const response = await get('/subtitles/source-subs/track-embedded.vtt')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Hello')
  })

  test('a bitmap track is not sent (burnt in): subtitle_unsupported', async () => {
    const response = await get('/subtitles/source-movie/track-pgs.vtt')
    expect(response.status).toBe(422)
    expect(await codeOf(response)).toBe('playback/subtitle_unsupported')
  })

  test('a profile without access, another source, a wrong suffix: not found', async () => {
    for (const [path, headers] of [
      ['/subtitles/source-movie/track-fr.vtt', kid],
      ['/subtitles/source-subs/track-fr.vtt', {}],
      ['/subtitles/source-movie/track-fr.srt', {}],
      ['/subtitles/source-movie/nope.vtt', {}],
    ] as const) {
      const response = await get(path, headers)
      expect(response.status).toBe(404)
      expect(await codeOf(response)).toBe('playback/subtitle_not_found')
    }
    expect(existsSync(join(data.path, 'cache/subtitles/source-movie'))).toBe(false)
  })

  test('pre_extract_subtitles: extracted after the probe', async () => {
    db.update(libraries).set({ preExtractSubtitles: true }).run()
    publish('source.ready', { sourceId: 'source-subs', libraryId: 'library-1' })
    const job = jobs.enqueued.find((entry) => entry.type === 'extract_subtitles')
    expect(job).toEqual({
      type: 'extract_subtitles',
      payload: { sourceId: 'source-subs' },
      dedupeKey: 'subtitles:source-subs',
    })
    expect(await run(assets.jobHandlers.extract_subtitles, job?.payload)).toEqual({
      ok: true,
      value: undefined,
    })
    expect(
      readFileSync(join(data.path, 'cache/subtitles/source-subs/track-embedded.vtt'), 'utf8'),
    ).toContain('Hello')
  })
})

describe.skipIf(!hasFfmpeg())('trickplay (§10.5)', () => {
  test('sprites and index after the probe, served to profiles that may play the source', async () => {
    // As the playback module builds it for the session DTO.
    const trickplayUrl = trickplayUrlFactory({
      catalogRepository: createSqliteCatalogRepository({ db }),
      trickplayStore: createTrickplayStore({ trickplayDir: join(data.path, 'cache/trickplay') }),
    })
    expect(trickplayUrl('source-movie')).toBeUndefined()
    publish('source.ready', { sourceId: 'source-movie', libraryId: 'library-1' })
    expect(jobs.enqueued).toContainEqual({
      type: 'trickplay',
      payload: { sourceId: 'source-movie' },
      dedupeKey: 'trickplay:source-movie',
    })
    expect((await run(assets.jobHandlers.trickplay, { sourceId: 'source-movie' })).ok).toBe(true)

    expect(trickplayUrl('source-movie')).toBe('/api/v1/trickplay/source-movie/index.json')
    const index = await get('/trickplay/source-movie/index.json')
    expect(index.status).toBe(200)
    const body = trickplayIndexDtoSchema.parse(await index.json())
    expect(body).toEqual({
      interval: 10,
      width: 320,
      height: 180,
      columns: 10,
      rows: 10,
      sheets: [0],
    })
    const sheet = await get('/trickplay/source-movie/0.jpg')
    expect(sheet.status).toBe(200)
    expect(sheet.headers.get('content-type')).toBe('image/jpeg')
    expect([...new Uint8Array(await sheet.arrayBuffer()).slice(0, 2)]).toEqual([0xff, 0xd8])

    expect((await get('/trickplay/source-movie/1.jpg')).status).toBe(404)
    expect((await get('/trickplay/source-movie/../index.json')).status).toBe(404)
    expect((await get('/trickplay/source-movie/index.json', kid)).status).toBe(404)
    expect((await get('/trickplay/source-movie/0.jpg', kid)).status).toBe(404)

    // The file changed (new size / mtime in the database): stale until rebuilt.
    db.update(sources).set({ mtime: 1 }).where(eq(sources.id, 'source-movie')).run()
    expect(trickplayUrl('source-movie')).toBeUndefined()
    expect((await get('/trickplay/source-movie/index.json')).status).toBe(404)
  })

  test('resume frame (§13.3): the thumbnail at the position, once the sprites exist', async () => {
    const frame = (positionMs: number, profileId = 'profile-of-leo') =>
      assets.homeResumeFrames({ itemId: 'movie', positionMs, profileId })
    expect(frame(25_000)).toBeUndefined()
    await run(assets.jobHandlers.trickplay, { sourceId: 'source-movie' })

    // 22 s: the nearest thumbnail is the one at 20 s, its still extracted from the video.
    expect(frame(22_000)).toEqual({ sourceId: 'source-movie', second: 20 })
    if (hasFfmpegEncoder('libwebp')) {
      const still = await get('/trickplay/source-movie/frames/20.webp')
      expect(still.status).toBe(200)
      expect(still.headers.get('content-type')).toBe('image/webp')
    }
    // Only the instants of the index (one file per thumbnail at most), only for who may play it.
    expect((await get('/trickplay/source-movie/frames/25.webp')).status).toBe(404)
    expect((await get('/trickplay/source-movie/frames/40.webp')).status).toBe(404)
    expect((await get('/trickplay/source-movie/frames/20.webp', kid)).status).toBe(404)
    // Past the last thumbnail: the last one (the file probes a hair over 30 s: the one at 30 s);
    // a profile that cannot see the item: none.
    expect(frame(9_999_000)).toEqual({ sourceId: 'source-movie', second: 30 })
    expect(frame(25_000, 'profile-kid')).toBeUndefined()

    // The file changed: the sprites are stale, no frame.
    db.update(sources).set({ mtime: 1 }).where(eq(sources.id, 'source-movie')).run()
    expect(frame(25_000)).toBeUndefined()
  })

  test('a video stream starting after 0 (remuxed MKV, 3 s) still gets its first thumbnail', async () => {
    expect((await run(assets.jobHandlers.trickplay, { sourceId: 'source-subs' })).ok).toBe(true)
    const index = trickplayIndexDtoSchema.parse(
      await (await get('/trickplay/source-subs/index.json')).json(),
    )
    expect(index.sheets).toEqual([0])
  })

  test('nothing when the library or the server turned it off', async () => {
    db.update(libraries).set({ trickplayEnabled: false }).run()
    publish('source.ready', { sourceId: 'source-movie', libraryId: 'library-1' })
    expect(jobs.enqueued.filter((job) => job.type === 'trickplay')).toEqual([])
    await run(assets.jobHandlers.trickplay, { sourceId: 'source-movie' })
    expect(existsSync(join(data.path, 'cache/trickplay/source-movie'))).toBe(false)

    db.update(libraries).set({ trickplayEnabled: true }).run()
    db.insert(settings)
      .values({
        key: 'playback.trickplay_enabled',
        value: false,
        updatedAt: new Date().toISOString(),
      })
      .run()
    await run(assets.jobHandlers.trickplay, { sourceId: 'source-movie' })
    expect(existsSync(join(data.path, 'cache/trickplay/source-movie'))).toBe(false)
  })

  test('backfill: the ready sources without sprites are queued', async () => {
    await run(assets.jobHandlers.trickplay, { sourceId: 'source-movie' })
    const backfill = assets.scheduledTasks.find((task) => task.name === 'trickplay-backfill')
    await backfill?.run()
    expect(
      jobs.enqueued
        .filter((job) => job.type === 'trickplay')
        .map((job) => job.payload)
        .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toEqual([{ sourceId: 'source-episode' }, { sourceId: 'source-subs' }])
  })
})

describe.skipIf(!hasFfmpeg())('hero preview (§13.3)', () => {
  test('a movie: cut, served with Range, offered on the hero', async () => {
    expect(
      assets.homePreviews.previewUrl({ itemId: 'movie', profileId: 'profile-of-leo' }),
    ).toBeUndefined()
    // Missing: requested once.
    expect(jobs.enqueued).toEqual([
      { type: 'preview_clip', payload: { itemId: 'movie' }, dedupeKey: 'preview:movie' },
    ])
    expect((await run(assets.jobHandlers.preview_clip, { itemId: 'movie' })).ok).toBe(true)
    expect(assets.homePreviews.previewUrl({ itemId: 'movie', profileId: 'profile-of-leo' })).toBe(
      '/api/v1/previews/movie.mp4',
    )
    expect(
      assets.homePreviews.previewUrl({ itemId: 'movie', profileId: 'profile-kid' }),
    ).toBeUndefined()

    const full = await get('/previews/movie.mp4')
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    const size = (await full.arrayBuffer()).byteLength
    expect(size).toBeGreaterThan(1000)
    const partial = await get('/previews/movie.mp4', { range: 'bytes=0-99' })
    expect(partial.status).toBe(206)
    expect(partial.headers.get('content-range')).toBe(`bytes 0-99/${size}`)
    expect((await partial.arrayBuffer()).byteLength).toBe(100)
    expect((await get('/previews/movie.mp4', kid)).status).toBe(404)
    expect((await get('/previews/series.mp4')).status).toBe(404)
    // Not an id of the database: 404, never a file name tried.
    for (const name of ['a%20b.mp4', '..mp4', '.mp4', '-x.mp4']) {
      const response = await get(`/previews/${name}`)
      expect(response.status).toBe(404)
      expect(await codeOf(response)).toBe('playback/preview_not_found')
    }

    // 20 s, at most 720p, H.264 + AAC.
    const probe = await createFfprobeProber().probe({
      path: join(data.path, 'cache/previews/movie.mp4'),
    })
    expect(probe.ok && probe.value.video[0]?.codec).toBe('h264')
    expect(probe.ok && probe.value.audio[0]?.codec).toBe('aac')
    expect(probe.ok && Math.round(probe.value.durationMs / 1000)).toBe(20)
  })

  test('a series: from its most recent episode, after the enrichment of an episode', async () => {
    const { job } = jobRepository.enqueue({
      id: 'job-images',
      type: 'fetch_images',
      payload: { itemId: 'episode' },
      priority: 40,
      maxAttempts: 3,
      runAfter: new Date(0),
    })
    publish('job.updated', { jobId: job.id, type: 'fetch_images', state: 'done', attempts: 1 })
    expect(jobs.enqueued).toEqual([
      { type: 'preview_clip', payload: { itemId: 'series' }, dedupeKey: 'preview:series' },
    ])
    expect((await run(assets.jobHandlers.preview_clip, { itemId: 'series' })).ok).toBe(true)
    expect((await get('/previews/series.mp4')).status).toBe(200)

    // Home rows: what enters "Continuer" / "Up next" without a clip gets one requested.
    jobs.enqueued.length = 0
    assets.homePreviews.prepare({ itemIds: ['episode', 'movie'], profileId: 'profile-of-leo' })
    expect(jobs.enqueued).toEqual([
      { type: 'preview_clip', payload: { itemId: 'movie' }, dedupeKey: 'preview:movie' },
    ])
  })
})

describe.skipIf(!hasFfmpeg())('cleanup (§10.5 "supprimées avec la source")', () => {
  test('files of deleted sources, replaced tracks and orphan previews are removed', async () => {
    await get('/subtitles/source-movie/track-fr.vtt')
    await run(assets.jobHandlers.trickplay, { sourceId: 'source-movie' })
    await run(assets.jobHandlers.trickplay, { sourceId: 'source-subs' })
    await run(assets.jobHandlers.preview_clip, { itemId: 'movie' })
    const cache = join(data.path, 'cache')

    const cleanup = assets.scheduledTasks.find((task) => task.name === 'media-assets-cleanup')
    await cleanup?.run()
    expect(existsSync(join(cache, 'subtitles/source-movie/track-fr.vtt'))).toBe(true)
    expect(existsSync(join(cache, 'trickplay/source-movie/index.json'))).toBe(true)
    expect(existsSync(join(cache, 'previews/movie.mp4'))).toBe(true)

    db.delete(sources).where(eq(sources.id, 'source-movie')).run()
    await cleanup?.run()
    expect(existsSync(join(cache, 'subtitles/source-movie'))).toBe(false)
    expect(existsSync(join(cache, 'trickplay/source-movie'))).toBe(false)
    expect(existsSync(join(cache, 'previews/movie.mp4'))).toBe(false)
    expect(existsSync(join(cache, 'trickplay/source-subs/index.json'))).toBe(true)
    expect(events.filter((event) => event.type === 'catalog.changed')).toEqual([])
  })

  test('names that are not ids are left alone; temporaries of a crash go after 6 h', async () => {
    const cache = join(data.path, 'cache')
    const strays = [
      'subtitles/a b/x.vtt',
      'subtitles/source-subs/x y.vtt',
      'trickplay/a b/index.json',
      'previews/a b.mp4',
    ]
    const old = [
      'subtitles/source-subs/track-embedded.tmp-1-1.vtt',
      'trickplay/.tmp-source-subs-1-1/0.jpg',
      'previews/.tmp-movie-1-1.mp4',
    ]
    const recent = 'previews/.tmp-movie-2-2.mp4'
    for (const path of [...strays, ...old, recent]) {
      mkdirSync(join(cache, path, '..'), { recursive: true })
      writeFileSync(join(cache, path), '')
    }
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000)
    for (const path of old) utimesSync(join(cache, path), dayAgo, dayAgo)
    utimesSync(join(cache, 'trickplay/.tmp-source-subs-1-1'), dayAgo, dayAgo)

    const cleanup = assets.scheduledTasks.find((task) => task.name === 'media-assets-cleanup')
    await cleanup?.run()
    expect(strays.map((path) => existsSync(join(cache, path)))).toEqual([true, true, true, true])
    expect(old.map((path) => existsSync(join(cache, path)))).toEqual([false, false, false])
    expect(existsSync(join(cache, recent))).toBe(true)
  })
})
