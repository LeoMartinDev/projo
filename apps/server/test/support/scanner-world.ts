import { resolve } from 'node:path'

import { Hono } from 'hono'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { LibraryMetadataContextObserver } from '../../src/core/library/library.ts'
import { resolveAppPaths } from '../../src/entrypoints/app-paths.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import type { JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { createJobQueue } from '../../src/entrypoints/jobs/job-queue.ts'
import { buildFsModule } from '../../src/entrypoints/modules/fs.ts'
import { buildLibrariesModule } from '../../src/entrypoints/modules/libraries.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { buildScannerModule } from '../../src/entrypoints/modules/scanner.ts'
import { buildSourcesModule } from '../../src/entrypoints/modules/sources.ts'
import { createUuidV7Generator } from '../../src/infrastructure/ids/uuid-v7.ts'
import {
  endPlaybackSessionFactory,
  endPlaybackSessionsWithinFactory,
} from '../../src/application/playback/session-lifecycle.ts'
import type { HlsSegmenter } from '../../src/core/playback/ports.ts'
import { createSqliteJobRepository } from '../../src/infrastructure/sqlite/job-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../src/infrastructure/sqlite/playback-session-repository.ts'
import { stripNulls } from '../../src/infrastructure/sqlite/rows.ts'
import { seedViewer } from './catalog-fixtures.ts'
import { createManualClock } from './clock.ts'
import { createTestDatabase } from './database.ts'
import { createRecordingEventBus } from './fakes.ts'
import { silentLogger } from './logger.ts'

/**
 * The libraries, fs, sources and scanner modules on an in-memory database with a manual clock,
 * the real job queue, real file system, ffprobe and ffmpeg. Jobs run only when `runJobs` says so.
 * Playback sessions are ended for real (rows, events), with a segmenter that only records `stop`
 * (`stoppedStreams`); `startPlayback(sourceId)` opens one on a source.
 */
export const createScannerWorld = () => {
  const db = createTestDatabase()
  const clock = createManualClock(new Date('2026-06-01T10:00:00.000Z'))
  const ids = createUuidV7Generator({ clock })
  const { bus: eventBus, events } = createRecordingEventBus()
  const jobRepository = createSqliteJobRepository({ db })
  const { queue: jobQueue } = createJobQueue({ jobRepository, ids, clock, eventBus })
  const platform: Platform = {
    config: { port: 0, dataDir: '/nonexistent', trustProxy: false, logLevel: 'error' },
    paths: dataPathsFor('/nonexistent'),
    appPaths: resolveAppPaths(resolve(import.meta.dir, '../../src/entrypoints')),
    version: 'test',
    runtime: 'test',
    logger: silentLogger,
    clock,
    ids,
    eventBus,
    db,
    jobQueue,
    jobRepository,
    connectJobRunner: () => {},
  }
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
        clock,
        logger: silentLogger,
      }),
    }),
  }
  // Bound by the metadata world (§9.4 refresh on a new language or rating country); else no-op.
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
  const scanner = buildScannerModule(platform, { playbackSessions })

  let viewer: ReturnType<typeof seedViewer> | undefined
  /** An active `direct` session on this source and its first linked item. */
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
  const handlers = scanner.jobHandlers ?? {}

  /** Admin API: every request is made by an admin (the auth module is tested on its own). */
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

  /** Runs due jobs of these types (oldest, highest priority first) until none is left. */
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

  /** Raw SQL for assertions; NULL columns are left out of the rows. */
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
      await scanner.stop?.()
    },
  }
}

export type ScannerWorld = ReturnType<typeof createScannerWorld>
