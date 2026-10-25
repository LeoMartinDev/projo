import { andThen, type AppError, map, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import { type DataPaths, dataPathsFor } from '../../core/data-paths.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue, JobRepository } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import { systemClock } from '../../infrastructure/clock/system-clock.ts'
import { createInMemoryEventBus } from '../../infrastructure/events/in-memory-event-bus.ts'
import { ensureDataLayout } from '../../infrastructure/fs/data-layout.ts'
import { createUuidV7Generator } from '../../infrastructure/ids/uuid-v7.ts'
import { type Db, openDatabase } from '../../infrastructure/sqlite/database.ts'
import { createSqliteJobRepository } from '../../infrastructure/sqlite/job-repository.ts'
import type { AppPaths } from '../app-paths.ts'
import type { Config } from '../config.ts'
import { createJobQueue } from '../jobs/job-queue.ts'

/** Cross-cutting dependencies handed to every `build<Domain>Module`. */
export type Platform = {
  config: Config
  paths: DataPaths
  appPaths: AppPaths
  version: string
  runtime: string
  logger: Logger
  clock: Clock
  ids: IdGenerator
  eventBus: EventBus
  db: Db
  jobQueue: JobQueue
  jobRepository: JobRepository
  /** Lets the job runner (built after the modules) be woken by `jobQueue.enqueue`. */
  connectJobRunner: (wake: () => void) => void
}

type BuildPlatformInput = {
  config: Config
  appPaths: AppPaths
  logger: Logger
  version: string
  runtime: string
}

export type BuildPlatformError = AppError<
  'data/layout_failed' | 'db/open_failed' | 'db/migration_failed' | 'db/backup_failed'
>

/** Data layout (§5.4) → SQLite + migrations → ids, events, job queue. */
export const buildPlatform = ({
  config,
  appPaths,
  logger,
  version,
  runtime,
}: BuildPlatformInput): Result<Platform, BuildPlatformError> => {
  const clock = systemClock
  const paths = dataPathsFor(config.dataDir)

  return map(
    andThen(ensureDataLayout(paths), () =>
      openDatabase({
        file: paths.db.file,
        migrationsDir: appPaths.migrationsDir,
        backupsDir: paths.db.backups,
        clock,
        logger,
      }),
    ),
    (db) => {
      const ids = createUuidV7Generator({ clock })
      const eventBus = createInMemoryEventBus({ logger })
      const jobRepository = createSqliteJobRepository({ db })
      const { queue, connectRunner } = createJobQueue({ jobRepository, ids, clock, eventBus })
      return {
        config,
        paths,
        appPaths,
        version,
        runtime,
        logger,
        clock,
        ids,
        eventBus,
        db,
        jobQueue: queue,
        jobRepository,
        connectJobRunner: connectRunner,
      }
    },
  )
}
