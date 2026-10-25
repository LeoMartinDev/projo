import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

import { adminPlaybackSessionDtoSchema } from '@projo/shared/api/playback'

import {
  insertItem,
  insertLibrary,
  insertSource,
  seedViewer,
} from '../../../../test/support/catalog-fixtures.ts'
import { createManualClock, type ManualClock } from '../../../../test/support/clock.ts'
import { createTestDatabase } from '../../../../test/support/database.ts'
import { createRecordingEventBus } from '../../../../test/support/fakes.ts'
import { silentLogger } from '../../../../test/support/logger.ts'
import { endPlaybackSessionFactory } from '../../../application/playback/session-lifecycle.ts'
import type { ServerEvent } from '../../../core/events.ts'
import type { HlsSegmenter } from '../../../core/playback/ports.ts'
import type { Db } from '../../../infrastructure/sqlite/database.ts'
import { createSqlitePlaybackSessionRepository } from '../../../infrastructure/sqlite/playback-session-repository.ts'
import { profiles, sessions } from '../../../infrastructure/sqlite/schema/accounts.ts'
import { buildAdminPlaybackModule } from '../../modules/admin-playback.ts'
import type { Platform } from '../../modules/platform.ts'
import type { AppEnv } from '../context.ts'

let db: Db
let clock: ManualClock
let events: ServerEvent[]
let stopped: string[]
let app: Hono<AppEnv>

beforeEach(() => {
  db = createTestDatabase()
  clock = createManualClock(new Date('2026-10-23T20:00:00.000Z'))
  const bus = createRecordingEventBus()
  events = bus.events
  stopped = []
  const sessionRepository = createSqlitePlaybackSessionRepository({ db })
  const endSession = endPlaybackSessionFactory({
    sessionRepository,
    segmenter: { stop: (id: string) => void stopped.push(id) } as unknown as HlsSegmenter,
    eventBus: bus.bus,
    clock,
    logger: silentLogger,
  })
  const module = buildAdminPlaybackModule(
    { db, clock, logger: silentLogger } as unknown as Platform,
    { endSession },
  )
  app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('account', { id: 'leo', username: 'leo', role: 'admin' })
      c.set('session', { id: 'session-of-leo', accountId: 'leo', kind: 'cookie' })
      await next()
    })
    .route('/admin', module.routes)

  seedViewer(db, 'leo')
  db.update(sessions).set({ deviceName: 'Firefox · macOS' }).run()
  db.update(profiles).set({ name: 'Léo', avatarColor: 'sage' }).run()
  insertLibrary(db)
  insertItem(db, { id: 'movie', kind: 'movie', title: 'Dune' })
  insertItem(db, { id: 'series', kind: 'series', title: 'Severance' })
  insertItem(db, { id: 'season', kind: 'season', parentId: 'series', seasonNumber: 2 })
  insertItem(db, {
    id: 'episode',
    kind: 'episode',
    parentId: 'season',
    title: 'Goodbye',
    seasonNumber: 2,
    episodeNumber: 4,
  })
  insertSource(db, {
    id: 'source-movie',
    itemId: 'movie',
    parsed: { title: 'Dune', edition: 'imax' },
    probe: {
      durationMs: 9_000_000,
      video: [{ index: 0, codec: 'hevc', width: 3840, height: 1608, dynamicRange: 'hdr' }],
      audio: [],
      subtitles: [],
    },
  })
  insertSource(db, { id: 'source-episode', itemId: 'episode' })
  const at = (offsetMs: number) => new Date(clock.now().getTime() + offsetMs)
  for (const session of [
    { id: 'ps-movie', sourceId: 'source-movie', itemId: 'movie', mode: 'hls_transcode' as const },
    { id: 'ps-episode', sourceId: 'source-episode', itemId: 'episode', mode: 'direct' as const },
  ]) {
    sessionRepository.insert({
      ...session,
      profileId: 'profile-of-leo',
      authSessionId: 'session-of-leo',
      ...(session.mode === 'hls_transcode' ? { quality: '720p' as const } : {}),
      burnIn: session.mode === 'hls_transcode',
      startedAt: at(session.mode === 'direct' ? -60_000 : -120_000),
      lastHeartbeatAt: at(-5_000),
      positionMs: 754_000,
    })
  }
})

describe('admin playback sessions (§10.6)', () => {
  test('lists who watches what, newest first', async () => {
    const response = await app.request('/admin/playback/sessions')
    expect(response.status).toBe(200)
    const body = adminPlaybackSessionDtoSchema.array().parse(await response.json())
    expect(body).toEqual([
      {
        id: 'ps-episode',
        account: { id: 'leo', name: 'leo' },
        profile: { id: 'profile-of-leo', name: 'Léo', color: 'sage' },
        item: {
          id: 'episode',
          kind: 'episode',
          title: 'Goodbye',
          seriesTitle: 'Severance',
          seasonNumber: 2,
          episodeNumber: 4,
        },
        mode: 'direct',
        quality: 'original',
        burnIn: false,
        version: {},
        positionMs: 754_000,
        device: 'Firefox · macOS',
        startedAt: '2026-10-23T19:59:00.000Z',
        lastHeartbeatAt: '2026-10-23T19:59:55.000Z',
      },
      {
        id: 'ps-movie',
        account: { id: 'leo', name: 'leo' },
        profile: { id: 'profile-of-leo', name: 'Léo', color: 'sage' },
        item: { id: 'movie', kind: 'movie', title: 'Dune' },
        mode: 'hls_transcode',
        quality: '720p',
        burnIn: true,
        version: {
          resolution: '2160p',
          dynamicRange: 'hdr',
          videoCodec: 'hevc',
          edition: 'imax',
        },
        positionMs: 754_000,
        durationMs: 9_000_000,
        device: 'Firefox · macOS',
        startedAt: '2026-10-23T19:58:00.000Z',
        lastHeartbeatAt: '2026-10-23T19:59:55.000Z',
      },
    ])
  })

  test('a movie in parts: the duration of the version (the parts added up)', async () => {
    const part = (id: string, partIndex: number, durationMs: number) =>
      insertSource(db, {
        id,
        itemId: 'movie',
        stackGroupId: 'stack',
        partIndex,
        probe: { durationMs, video: [{ index: 0, codec: 'h264' }], audio: [], subtitles: [] },
      })
    part('cd1', 1, 3_000_000)
    part('cd2', 2, 2_500_000)
    createSqlitePlaybackSessionRepository({ db }).insert({
      id: 'ps-parts',
      sourceId: 'cd2',
      itemId: 'movie',
      mode: 'direct',
      profileId: 'profile-of-leo',
      authSessionId: 'session-of-leo',
      burnIn: false,
      startedAt: clock.now(),
      lastHeartbeatAt: clock.now(),
      positionMs: 3_100_000,
    })
    const body = adminPlaybackSessionDtoSchema
      .array()
      .parse(await (await app.request('/admin/playback/sessions')).json())
    expect(body.find((session) => session.id === 'ps-parts')?.durationMs).toBe(5_500_000)
  })

  test('a session silent for 60 s is no longer listed', async () => {
    clock.advance(55_000)
    expect(await (await app.request('/admin/playback/sessions')).json()).toEqual([])
  })

  test('"Arrêter": ended, ffmpeg stopped, the player told (reason admin)', async () => {
    const response = await app.request('/admin/playback/sessions/ps-movie', { method: 'DELETE' })
    expect(response.status).toBe(204)
    expect(stopped).toEqual(['ps-movie'])
    expect(events).toEqual([
      {
        type: 'playback.session_terminated',
        payload: { playbackSessionId: 'ps-movie', sessionId: 'session-of-leo', reason: 'admin' },
      },
    ])
    const left = (await (await app.request('/admin/playback/sessions')).json()) as { id: string }[]
    expect(left.map((session) => session.id)).toEqual(['ps-episode'])
    // Already ended, or unknown: 404.
    for (const id of ['ps-movie', 'nope']) {
      const again = await app.request(`/admin/playback/sessions/${id}`, { method: 'DELETE' })
      expect(again.status).toBe(404)
    }
  })
})
