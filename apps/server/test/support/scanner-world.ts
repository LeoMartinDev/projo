import { Hono } from 'hono'

import type { JobType } from '../../src/core/jobs/job.ts'
import type { LibraryMetadataContextObserver } from '../../src/core/library/library.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import type { JobHandler, JobHandlers } from '../../src/entrypoints/jobs/handler.ts'
import { createJobQueue } from '../../src/entrypoints/jobs/job-queue.ts'
import { buildFsModule } from '../../src/entrypoints/modules/fs.ts'
import { buildLibrariesModule } from '../../src/entrypoints/modules/libraries.ts'
import { buildScannerModule } from '../../src/entrypoints/modules/scanner.ts'
import { buildSourcesModule } from '../../src/entrypoints/modules/sources.ts'
import { createUuidV7Generator } from '../../src/infrastructure/ids/uuid-v7.ts'
import { endPlaybackSessionFactory } from '../../src/application/playback/end-playback-session.ts'
import { endPlaybackSessionsWithinFactory } from '../../src/application/playback/end-playback-sessions-within.ts'
import type { HlsSegmenter } from '../../src/core/playback/ports.ts'
import { createSqliteJobRepository } from '../../src/infrastructure/sqlite/job-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../src/infrastructure/sqlite/playback-session-repository.ts'
import { stripNulls } from '../../src/infrastructure/sqlite/rows.ts'
import { seedViewer } from './catalog-fixtures.ts'
import { createManualClock } from './clock.ts'
import { createTestDatabase } from './database.ts'
import { createRecordingEventBus, createTestAfterCommit } from './fakes.ts'
import { silentLogger } from './logger.ts'
import { createTestPlatform } from './platform.ts'

export const createScannerWorld = () => {
  const db = createTestDatabase()
  const clock = createManualClock(new Date('2026-06-01T10:00:00.000Z'))
  const ids = createUuidV7Generator({ clock })
  const afterCommit = createTestAfterCommit(db)
  const { bus: eventBus, events } = createRecordingEventBus({ afterCommit })
  const jobRepository = createSqliteJobRepository({ db })
  const { queue: jobQueue } = createJobQueue({ jobRepository, ids, clock, eventBus })
  const platform = createTestPlatform({
    db,
    clock,
    ids,
    eventBus,
    afterCommit,
    jobRepository,
    jobQueue,
  })
  const playbackSessionRepository = createSqlitePlaybackSessionRepository({ db })
  const stoppedStreams: string[] = []
  const segmenter: HlsSegmenter = {
    segment: async () => {
      throw new Error('no streaming in the scanner world')
    },
    stop: (sessionId) => void stoppedStreams.push(sessionId),
    stopAll: async () => {},
    sessionIds: () => [],
  }
  const playbackSessions = {
    endWithin: endPlaybackSessionsWithinFactory({
      sessionRepository: playbackSessionRepository,
      endSession: endPlaybackSessionFactory({
        sessionRepository: playbackSessionRepository,
        segmenter,
        eventBus,
        afterCommit,
        clock,
        logger: silentLogger,
      }),
    }),
  }
  const metadataContextLater: { current?: LibraryMetadataContextObserver } = {}
  const libraries = buildLibrariesModule(platform, {
    playbackSessions,
    metadataContext: {
      changed: (input) => metadataContextLater.current?.changed(input),
      filesLeaving: (files) => metadataContextLater.current?.filesLeaving(files) ?? (() => {}),
    },
  })
  const fs = buildFsModule(platform)
  const sources = buildSourcesModule(platform)
  // Straight to the queue: the metadata module's `requestMatch` (which first checks the TMDB key)
  // is not part of this world.
  const scanner = buildScannerModule(platform, {
    playbackSessions,
    requestMatch: ({ sourceId }) =>
      void jobQueue.enqueue({
        type: 'match_source',
        payload: { sourceId },
        dedupeKey: `match:${sourceId}`,
      }),
  })

  let viewer: ReturnType<typeof seedViewer> | undefined
  const startPlayback = (sourceId: string) => {
    viewer ??= seedViewer(db, 'viewer-1')
    const [link] = query<{ item_id: string }>(
      'SELECT item_id FROM source_items WHERE source_id = ? ORDER BY item_id',
      sourceId,
    )
    if (link === undefined) throw new Error(`source ${sourceId} is linked to no item`)
    const id = ids.next()
    playbackSessionRepository.insert({
      id,
      profileId: viewer.profileId,
      authSessionId: viewer.authSessionId,
      sourceId,
      itemId: link.item_id,
      mode: 'direct',
      burnIn: false,
      startedAt: clock.now(),
      lastHeartbeatAt: clock.now(),
      positionMs: 0,
    })
    return { id, authSessionId: viewer.authSessionId }
  }
  const handlers: JobHandlers = scanner.jobHandlers

  const app = new Hono<AppEnv>()
    .use('*', async (c, next) => {
      c.set('logger', silentLogger)
      c.set('account', { id: 'admin-1', username: 'leo', role: 'admin' })
      await next()
    })
    .route('/api/v1/admin', libraries.routes)
    .route('/api/v1/admin', fs.routes)
    .route('/api/v1/admin', sources.routes)

  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init
    return app.request(`/api/v1/admin${path}`, {
      ...rest,
      ...(json === undefined
        ? {}
        : { body: JSON.stringify(json), headers: { 'content-type': 'application/json' } }),
    })
  }

  const runJobs = async (types: readonly JobType[], max = 500): Promise<number> => {
    let ran = 0
    while (ran < max) {
      const job = jobRepository.claimNext({ types, now: clock.now() })
      if (job === undefined) return ran
      const handler: JobHandler | undefined = handlers[job.type]
      if (handler === undefined) throw new Error(`no handler for ${job.type}`)
      const result = await handler.run(job.payload, {
        job,
        signal: new AbortController().signal,
        reportProgress: () => {},
        logger: silentLogger,
      })
      if (result.ok) jobRepository.complete({ id: job.id, finishedAt: clock.now() })
      else
        jobRepository.fail({
          id: job.id,
          error: { code: result.error.code, message: result.error.message },
          finishedAt: clock.now(),
        })
      ran += 1
    }
    return ran
  }

  const query = <T>(sql: string, ...params: (string | number)[]): T[] =>
    (db.$client.query(sql).all(...params) as Record<string, unknown>[]).map(stripNulls) as T[]

  return {
    db,
    clock,
    ids,
    events,
    jobQueue,
    jobRepository,
    platform,
    scanner,
    metadataContextLater,
    request,
    runJobs,
    query,
    startPlayback,
    stoppedStreams,
    stop: async () => {
      await scanner.stop()
    },
  }
}

export type ScannerWorld = ReturnType<typeof createScannerWorld>
