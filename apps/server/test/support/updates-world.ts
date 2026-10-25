import { resolve } from 'node:path'

import { Hono } from 'hono'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { Job } from '../../src/core/jobs/job.ts'
import { resolveAppPaths } from '../../src/entrypoints/app-paths.ts'
import type { AppEnv } from '../../src/entrypoints/http/context.ts'
import { createJobQueue } from '../../src/entrypoints/jobs/job-queue.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { buildUpdatesModule } from '../../src/entrypoints/modules/updates.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { createUuidV7Generator } from '../../src/infrastructure/ids/uuid-v7.ts'
import type { Db } from '../../src/infrastructure/sqlite/database.ts'
import { createSqliteJobRepository } from '../../src/infrastructure/sqlite/job-repository.ts'
import { createManualClock } from './clock.ts'
import { createTempDir, createTestDatabase } from './database.ts'
import { createRecordingEventBus } from './fakes.ts'
import { silentLogger } from './logger.ts'
import type { startGithubReleasesServer } from './github-releases-server.ts'

type ReleasesServer = ReturnType<typeof startGithubReleasesServer>

/**
 * The updates module on a real data directory (temporary) and an in-memory database, against the
 * fake GitHub of `github-releases-server.ts`. Jobs run only when `runJobs` says so; `exits`
 * counts the `exitForSwitch` calls. `restart(version)` builds the module again as the app the
 * supervisor relaunched (same data, same database) and runs its startup reconciliation.
 */
export const createUpdatesWorld = ({
  server,
  version = '1.3.0',
  runtime = '0.2.0',
  enabled = true,
}: {
  server: ReleasesServer
  version?: string
  runtime?: string
  enabled?: boolean
}) => {
  const dataDir = createTempDir('projo-updates-')
  const db: Db = createTestDatabase()
  const clock = createManualClock(new Date('2026-10-24T10:00:00.000Z'))
  const ids = createUuidV7Generator({ clock })
  const { bus: eventBus, events } = createRecordingEventBus()
  const jobRepository = createSqliteJobRepository({ db })
  const { queue: jobQueue } = createJobQueue({ jobRepository, ids, clock, eventBus })
  const paths = dataPathsFor(dataDir.path.replaceAll('\\', '/'))
  const layout = ensureDataLayout(paths)
  if (!layout.ok) throw new Error('cannot create the data layout')
  let exits = 0

  const build = (running: string) => {
    const platform: Platform = {
      config: { port: 0, dataDir: paths.root, trustProxy: false, logLevel: 'error' },
      paths,
      appPaths: resolveAppPaths(resolve(import.meta.dir, '../../src/entrypoints')),
      version: running,
      runtime,
      logger: silentLogger,
      clock,
      ids,
      eventBus,
      db,
      jobQueue,
      jobRepository,
      connectJobRunner: () => {},
    }
    const module = buildUpdatesModule(platform, {
      enabled,
      releasesBaseUrl: server.apiBaseUrl,
      releasesDownloadPrefix: server.downloadPrefix,
      exitForSwitch: () => {
        exits += 1
      },
    })
    const app = new Hono<AppEnv>()
      .use('*', async (c, next) => {
        c.set('logger', silentLogger)
        await next()
      })
      .route('/api/v1/admin', module.routes)
    return { module, app }
  }

  let current = build(version)

  const request = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const { json, ...rest } = init
    return current.app.request(`/api/v1/admin${path}`, {
      ...rest,
      ...(json === undefined
        ? {}
        : {
            method: rest.method ?? 'POST',
            body: JSON.stringify(json),
            headers: { 'content-type': 'application/json' },
          }),
    })
  }

  /** Runs the due `check_updates` / `apply_update` jobs; resolves with the settled jobs. */
  const runJobs = async (): Promise<Job[]> => {
    const settled: Job[] = []
    for (;;) {
      const job = jobRepository.claimNext({
        types: ['check_updates', 'apply_update'],
        now: clock.now(),
      })
      if (job === undefined) return settled
      const handler = current.module.jobHandlers[job.type as 'check_updates' | 'apply_update']
      const result = await handler.run(job.payload, {
        job,
        signal: new AbortController().signal,
        reportProgress: () => {},
        logger: silentLogger,
      })
      settled.push(
        result.ok
          ? jobRepository.complete({ id: job.id, finishedAt: clock.now() })
          : jobRepository.fail({
              id: job.id,
              error: { code: result.error.code, message: result.error.message },
              finishedAt: clock.now(),
            }),
      )
    }
  }

  return {
    paths,
    db,
    clock,
    events,
    request,
    runJobs,
    exits: () => exits,
    module: () => current.module,
    restart: async (running: string) => {
      current = build(running)
      await current.module.reconcile()
    },
    cleanup: dataDir.cleanup,
  }
}
