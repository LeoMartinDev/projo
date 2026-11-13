import { resolve } from 'node:path'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobControl } from '../../src/core/jobs/ports.ts'
import { resolveAppPaths } from '../../src/entrypoints/app-paths.ts'
import { createJobQueue } from '../../src/entrypoints/jobs/job-queue.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { createUuidV7Generator } from '../../src/infrastructure/ids/uuid-v7.ts'
import { createSqliteAdminNotifier } from '../../src/infrastructure/sqlite/admin-notifier.ts'
import { createSqliteJobRepository } from '../../src/infrastructure/sqlite/job-repository.ts'
import { createManualClock } from './clock.ts'
import { createTestDatabase } from './database.ts'
import { createRecordingEventBus, createTestAfterCommit } from './fakes.ts'
import { silentLogger } from './logger.ts'

/**
 * A complete `Platform` for tests that build modules by hand: every field has a test default
 * (in-memory database, manual clock, the real after-commit deferral, a recording event bus
 * delivering through it, real queue, no runner), and the defaults derived from another field
 * (notifier, job repository, queue…) use its override.
 *
 * `jobControl` stands in for the runner: `cancel` cancels a queued or running job in the
 * repository and publishes `job.updated` like `runner.cancel` (without waiting for a running
 * handler to return), `wake` does nothing.
 */
export const createTestPlatform = (overrides: Partial<Platform> = {}): Platform => {
  const db = overrides.db ?? createTestDatabase()
  const clock = overrides.clock ?? createManualClock(new Date('2026-06-01T10:00:00.000Z'))
  const ids = overrides.ids ?? createUuidV7Generator({ clock })
  const afterCommit = overrides.afterCommit ?? createTestAfterCommit(db)
  const eventBus = overrides.eventBus ?? createRecordingEventBus({ afterCommit }).bus
  const jobRepository = overrides.jobRepository ?? createSqliteJobRepository({ db })
  const jobQueue =
    overrides.jobQueue ?? createJobQueue({ jobRepository, ids, clock, eventBus }).queue
  const paths = overrides.paths ?? dataPathsFor('/nonexistent')
  const jobControl: JobControl = {
    cancel: (id) => {
      const cancelled = jobRepository.cancel({ id, finishedAt: clock.now() })
      if (cancelled !== undefined) {
        eventBus.publish('job.updated', {
          jobId: cancelled.id,
          type: cancelled.type,
          state: cancelled.state,
          attempts: cancelled.attempts,
        })
      }
      return cancelled
    },
    wake: () => {},
  }
  return {
    config: { port: 0, dataDir: paths.root, trustProxy: false, logLevel: 'error' },
    paths,
    appPaths: resolveAppPaths(resolve(import.meta.dir, '../../src/entrypoints')),
    version: 'test',
    runtime: 'test',
    logger: silentLogger,
    clock,
    ids,
    eventBus,
    afterCommit,
    notifier: createSqliteAdminNotifier({ db, ids, clock, eventBus }),
    db,
    jobQueue,
    jobRepository,
    jobControl,
    connectJobRunner: () => {},
    ...overrides,
  }
}
