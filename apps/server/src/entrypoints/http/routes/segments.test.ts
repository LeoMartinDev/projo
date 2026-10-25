import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import type { VisibilityScope } from '../../../core/catalog/catalog.ts'
import { dataPathsFor } from '../../../core/data-paths.ts'
import type { Job } from '../../../core/jobs/job.ts'
import { createSqliteJobRepository } from '../../../infrastructure/sqlite/job-repository.ts'
import type { Db } from '../../../infrastructure/sqlite/database.ts'
import { sources } from '../../../infrastructure/sqlite/schema/libraries.ts'
import { createSqliteSegmentRepository } from '../../../infrastructure/sqlite/segment-repository.ts'
import {
  insertItem,
  insertLibrary,
  insertSource,
} from '../../../../test/support/catalog-fixtures.ts'
import { createManualClock } from '../../../../test/support/clock.ts'
import { createTestDatabase } from '../../../../test/support/database.ts'
import {
  createRecordingEventBus,
  createRecordingJobQueue,
  createSequentialIds,
} from '../../../../test/support/fakes.ts'
import { silentLogger } from '../../../../test/support/logger.ts'
import { fakeSegmentProviders } from '../../../../test/support/segments.ts'
import { buildSegmentsModule } from '../../modules/segments.ts'
import type { Platform } from '../../modules/platform.ts'
import { type ApiRoutes, createApi } from '../api.ts'
import type { AppEnv } from '../context.ts'

const unwired = <K extends keyof ApiRoutes>() => new Hono<AppEnv>() as unknown as ApiRoutes[K]
const minute = 60_000

const probe = (
  durationMs: number,
  chapters: { startMs: number; endMs: number; title: string }[],
) => ({
  durationMs,
  video: [{ index: 0, codec: 'h264' }],
  audio: [],
  subtitles: [],
  chapters,
})

let db: Db
let jobs: ReturnType<typeof createRecordingJobQueue>
let bus: ReturnType<typeof createRecordingEventBus>
let fake: ReturnType<typeof fakeSegmentProviders>
let module: ReturnType<typeof buildSegmentsModule>
let call: (
  path: string,
  init?: { method?: string; json?: unknown; role?: 'admin' | 'user'; as?: string },
) => Response | Promise<Response>

const build = (scopes: Record<string, VisibilityScope> = {}) => {
  const clock = createManualClock(new Date('2026-10-24T12:00:00.000Z'))
  const platform = {
    db,
    clock,
    ids: createSequentialIds('seg-'),
    logger: silentLogger,
    eventBus: bus.bus,
    jobQueue: jobs.queue,
    jobRepository: createSqliteJobRepository({ db }),
    paths: dataPathsFor('/nonexistent'),
  } as unknown as Platform
  module = buildSegmentsModule(platform, {
    visibilityScope: (profileId) => scopes[profileId] ?? {},
    segmentProviders: fake.providers,
  })
  const api = createApi({
    middleware: {
      authenticate: async (c, next) => {
        const accountId = c.req.header('x-account') ?? 'leo'
        const role = c.req.header('x-role') === 'admin' ? 'admin' : 'user'
        c.set('account', { id: accountId, username: accountId, role })
        c.set('session', { id: `session-of-${accountId}`, accountId, kind: 'cookie' })
        c.set('profileId', `profile-of-${accountId}`)
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
      catalog: unwired<'catalog'>(),
      home: unwired<'home'>(),
      search: unwired<'search'>(),
      progress: unwired<'progress'>(),
      watchlist: unwired<'watchlist'>(),
      playback: unwired<'playback'>(),
      stream: unwired<'stream'>(),
      images: unwired<'images'>(),
      adminLibraries: unwired<'adminLibraries'>(),
      adminFs: unwired<'adminFs'>(),
      adminSources: unwired<'adminSources'>(),
      adminSourceReview: unwired<'adminSourceReview'>(),
      adminItems: unwired<'adminItems'>(),
      adminSettings: unwired<'adminSettings'>(),
      adminAccounts: unwired<'adminAccounts'>(),
      adminProfiles: unwired<'adminProfiles'>(),
      subtitles: unwired<'subtitles'>(),
      trickplay: unwired<'trickplay'>(),
      previews: unwired<'previews'>(),
      segments: module.routes.segments,
      adminSegments: module.routes.adminSegments,
      adminPlayback: unwired<'adminPlayback'>(),
      adminMissingSources: unwired<'adminMissingSources'>(),
      adminJobs: unwired<'adminJobs'>(),
      adminNotifications: unwired<'adminNotifications'>(),
      adminSystem: unwired<'adminSystem'>(),
      adminUpdates: unwired<'adminUpdates'>(),
    },
  })
  call = (path, { method = 'GET', json, role = 'user', as = 'leo' } = {}) =>
    api.request(path, {
      method,
      headers: {
        'x-account': as,
        'x-role': role,
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    })
  return platform
}

const runJob = async (type: 'fetch_segments' | 'submit_segment', payload: unknown) => {
  const handler = module.jobHandlers[type]
  return handler.run(payload, {
    job: { id: 'job', type } as Job,
    signal: new AbortController().signal,
    reportProgress: () => {},
    logger: silentLogger,
  })
}

beforeEach(() => {
  db = createTestDatabase()
  jobs = createRecordingJobQueue()
  bus = createRecordingEventBus()
  fake = fakeSegmentProviders({
    theintrodb: () => ({
      segments: [{ type: 'credits', startMs: 40 * minute, endMs: 45 * minute }],
      absent: [],
    }),
  })
  insertLibrary(db)
  insertLibrary(db, { id: 'library-2', rootPath: '/kids' })
  insertItem(db, { id: 'show', kind: 'series', tmdbId: 1399 })
  insertItem(db, { id: 's1', kind: 'season', parentId: 'show', seasonNumber: 1 })
  insertItem(db, { id: 'e1', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 1 })
  insertItem(db, { id: 'e2', kind: 'episode', parentId: 's1', seasonNumber: 1, episodeNumber: 2 })
  insertItem(db, { id: 'm1', kind: 'movie', tmdbId: 603 })
  insertSource(db, {
    id: 'f1',
    itemId: 'e1',
    probe: probe(45 * minute, [
      { startMs: 0, endMs: 90_000, title: 'Opening' },
      { startMs: 90_000, endMs: 40 * minute, title: 'Part A' },
    ]),
  })
  insertSource(db, { id: 'f2', itemId: 'e2', probe: probe(44 * minute, []) })
  insertSource(db, {
    id: 'f3',
    itemId: 'm1',
    libraryId: 'library-2',
    rootId: 'library-2-root',
    probe: probe(120 * minute, []),
  })
})

describe('fetch_segments job and its triggers', () => {
  test('chapters then providers, stored and served by GET /items/:id/segments', async () => {
    build()
    expect(await runJob('fetch_segments', { itemId: 'e1' })).toEqual({ ok: true, value: undefined })
    expect(fake.calls.map((entry) => [entry.provider, entry.durationMs])).toEqual([
      ['theintrodb', 45 * minute],
      ['introdb', 45 * minute],
      ['skipdb', 45 * minute],
    ])
    const response = await call('/items/e1/segments')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      itemId: 'e1',
      durationMs: 45 * minute,
      segments: [
        { type: 'intro', startMs: 0, endMs: 90_000, origin: 'chapter' },
        { type: 'credits', startMs: 40 * minute, endMs: 45 * minute, origin: 'theintrodb' },
      ],
      absent: [],
      lookups: [],
    })
    // The admin sees what the chain asked.
    const admin = (await (await call('/items/e1/segments', { role: 'admin' })).json()) as {
      lookups: { source: string; outcome: string }[]
    }
    expect(admin.lookups.map((row) => [row.source, row.outcome]).toSorted()).toEqual([
      ['chapter', 'found'],
      ['introdb', 'none'],
      ['skipdb', 'none'],
      ['theintrodb', 'found'],
    ])
  })

  test('after fetch_images of a movie or an episode: fetch_segments, misses forgotten', async () => {
    const platform = build()
    const segments = createSqliteSegmentRepository({ db, ids: platform.ids, clock: platform.clock })
    segments.saveLookup({
      itemId: 'e2',
      provider: 'introdb',
      checkedAt: platform.clock.now(),
      outcome: 'none',
    })
    segments.saveLookup({
      itemId: 'e2',
      provider: 'theintrodb',
      checkedAt: platform.clock.now(),
      outcome: 'found',
    })
    const finish = (itemId: string, state: 'done' | 'failed') => {
      const { job } = platform.jobRepository.enqueue({
        id: `images-${itemId}`,
        type: 'fetch_images',
        payload: { itemId },
        priority: 40,
        maxAttempts: 3,
        runAfter: new Date(0),
      })
      bus.bus.publish('job.updated', { jobId: job.id, type: 'fetch_images', state, attempts: 1 })
    }
    finish('e2', 'done')
    finish('m1', 'failed')
    finish('show', 'done')
    expect(jobs.enqueued).toEqual([
      { type: 'fetch_segments', payload: { itemId: 'e2' }, dedupeKey: 'segments:e2' },
      { type: 'fetch_segments', payload: { itemId: 'm1' }, dedupeKey: 'segments:m1' },
    ])
    expect(segments.listLookups('e2').map((row) => row.provider)).toEqual(['theintrodb'])
  })

  test('after match_source leaves a file unidentified: its chapters are read at once', async () => {
    const platform = build()
    db.update(sources).set({ matchState: 'needs_review' }).where(eq(sources.id, 'f1')).run()
    db.update(sources).set({ matchState: 'matched' }).where(eq(sources.id, 'f2')).run()
    let counter = 0
    const finish = (sourceId: string, state: 'done' | 'failed') => {
      counter += 1
      const { job } = platform.jobRepository.enqueue({
        id: `match-${counter}`,
        type: 'match_source',
        payload: { sourceId },
        priority: 60,
        maxAttempts: 3,
        runAfter: new Date(0),
      })
      bus.bus.publish('job.updated', { jobId: job.id, type: 'match_source', state, attempts: 1 })
    }
    // To review, matched (its `fetch_images` follows), TMDB unreachable (left `unmatched`).
    finish('f1', 'done')
    finish('f2', 'done')
    finish('f3', 'failed')
    expect(jobs.enqueued).toEqual([
      { type: 'fetch_segments', payload: { itemId: 'e1' }, dedupeKey: 'segments:e1' },
      { type: 'fetch_segments', payload: { itemId: 'm1' }, dedupeKey: 'segments:m1' },
    ])

    // Once resolved, another `match_source` of the file asks nothing more.
    expect(await runJob('fetch_segments', { itemId: 'e1' })).toEqual({ ok: true, value: undefined })
    jobs.enqueued.length = 0
    finish('f1', 'done')
    expect(jobs.enqueued).toEqual([])
    expect((await (await call('/items/e1/segments')).json()) as unknown).toMatchObject({
      segments: expect.arrayContaining([
        { type: 'intro', startMs: 0, endMs: 90_000, origin: 'chapter' },
      ]),
    })
  })

  test('backfill: movies and episodes without any lookup', async () => {
    build()
    await runJob('fetch_segments', { itemId: 'e1' })
    jobs.enqueued.length = 0
    const [backfill] = module.scheduledTasks
    await backfill?.run()
    expect(jobs.enqueued.map((job) => job.dedupeKey).toSorted()).toEqual([
      'segments:e2',
      'segments:m1',
    ])
  })
})

describe('GET /items/:id/segments (§14 scope)', () => {
  test('an item outside the profile scope, or not a movie / episode', async () => {
    build({ 'profile-of-kid': { libraryIds: ['library-1'] } })
    expect((await call('/items/m1/segments', { as: 'kid' })).status).toBe(404)
    expect((await call('/items/m1/segments')).status).toBe(200)
    const series = await call('/items/show/segments')
    expect(series.status).toBeGreaterThanOrEqual(400)
    expect(await series.json()).toMatchObject({ error: { code: 'item/invalid_kind' } })
  })
})

describe('manual markers (§12.5)', () => {
  test('PUT, negative marker, apply to the season, DELETE', async () => {
    build()
    const put = await call('/admin/items/e1/segments/intro', {
      method: 'PUT',
      json: { startMs: 5_000, endMs: 85_000 },
      role: 'admin',
    })
    expect(put.status).toBe(200)
    expect(await put.json()).toMatchObject({
      segments: [{ type: 'intro', origin: 'manual', startMs: 5_000, endMs: 85_000 }],
    })
    const absent = await call('/admin/items/e1/segments/credits', {
      method: 'PUT',
      json: { absent: true },
      role: 'admin',
    })
    expect(await absent.json()).toMatchObject({ absent: ['credits'] })

    const tooLong = await call('/admin/items/e1/segments/recap', {
      method: 'PUT',
      json: { startMs: 0, endMs: 50 * minute },
      role: 'admin',
    })
    expect(tooLong.status).toBe(422)

    const applied = await call('/admin/items/e1/segments/apply-to-season', {
      method: 'POST',
      json: {},
      role: 'admin',
    })
    expect(await applied.json()).toEqual({ updated: 1, skipped: 0 })
    expect(await (await call('/items/e2/segments')).json()).toMatchObject({
      segments: [{ type: 'intro', origin: 'manual', startMs: 5_000 }],
      absent: ['credits'],
    })

    const removed = await call('/admin/items/e2/segments/intro', {
      method: 'DELETE',
      role: 'admin',
    })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toMatchObject({ segments: [], absent: ['credits'] })
    expect(jobs.enqueued.at(-1)).toEqual({
      type: 'fetch_segments',
      payload: { itemId: 'e2' },
      dedupeKey: 'segments:e2',
    })
    const missing = await call('/admin/items/e2/segments/intro', {
      method: 'DELETE',
      role: 'admin',
    })
    expect(missing.status).toBe(404)
  })

  test('a movie cannot apply to a season', async () => {
    build()
    const response = await call('/admin/items/m1/segments/apply-to-season', {
      method: 'POST',
      json: {},
      role: 'admin',
    })
    expect(response.status).toBe(422)
  })

  test('submit_segment job: skipped while contribution is off', async () => {
    build()
    await call('/admin/items/m1/segments/intro', {
      method: 'PUT',
      json: { startMs: 0, endMs: 60_000 },
      role: 'admin',
    })
    expect(jobs.enqueued).toEqual([])
    expect(await runJob('submit_segment', { itemId: 'm1', type: 'intro' })).toMatchObject({
      ok: true,
    })
    expect(fake.submitted).toEqual([])
  })
})
