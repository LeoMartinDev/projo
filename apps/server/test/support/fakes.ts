import type { AfterCommit, ServerEvent } from '../../src/core/events.ts'
import type { IdGenerator } from '../../src/core/ids.ts'
import { jobDefaults, type Job } from '../../src/core/jobs/job.ts'
import type { EnqueueJobInput, JobQueue } from '../../src/core/jobs/ports.ts'
import { createInMemoryEventBus } from '../../src/infrastructure/events/in-memory-event-bus.ts'
import type { Db } from '../../src/infrastructure/sqlite/database.ts'
import { createSqliteAfterCommit } from '../../src/infrastructure/sqlite/transactions.ts'
import { throwingLogger } from './logger.ts'

export const createSequentialIds = (prefix = 'id-'): IdGenerator => {
  let counter = 0
  return {
    next: () => {
      counter += 1
      return `${prefix}${counter}`
    },
  }
}

/**
 * The after-commit deferral of `db` (the real one), whose failing effects fail the test instead
 * of being logged.
 */
export const createTestAfterCommit = (db: Db): AfterCommit =>
  createSqliteAfterCommit({ db, logger: throwingLogger })

/**
 * The real bus, recording each client event as it is delivered (after commit when `afterCommit`
 * defers it: `createTestAfterCommit(db)`, as `createTestPlatform` does). Internal events are
 * observed with `bus.on`. A throwing listener fails the publish instead of being logged.
 */
export const createRecordingEventBus = ({ afterCommit }: { afterCommit?: AfterCommit } = {}) => {
  const bus = createInMemoryEventBus({
    logger: throwingLogger,
    ...(afterCommit === undefined ? {} : { afterCommit }),
  })
  const events: ServerEvent[] = []
  bus.subscribe((event) => {
    events.push(event)
  })
  return { bus, events }
}

export const createRecordingJobQueue = () => {
  const enqueued: EnqueueJobInput[] = []
  const queued = new Map<string, Job>()
  let counter = 0
  const queue: JobQueue = {
    enqueue: (input) => {
      enqueued.push(input)
      const existing = input.dedupeKey === undefined ? undefined : queued.get(input.dedupeKey)
      if (existing !== undefined) return { job: existing, deduplicated: true }
      counter += 1
      const defaults = jobDefaults[input.type]
      const job: Job = {
        id: `job-${counter}`,
        type: input.type,
        payload: input.payload,
        priority: input.priority ?? defaults.priority,
        state: 'queued',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? defaults.maxAttempts,
        runAfter: input.runAfter ?? new Date(0),
        ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      }
      if (input.dedupeKey !== undefined) queued.set(input.dedupeKey, job)
      return { job, deduplicated: false }
    },
  }
  return { queue, enqueued }
}
