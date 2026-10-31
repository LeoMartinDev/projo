import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import { jobDefaults } from '../../core/jobs/job.ts'
import type { JobQueue, JobRepository } from '../../core/jobs/ports.ts'

type Deps = {
  jobRepository: JobRepository
  ids: IdGenerator
  clock: Clock
  eventBus: EventBus
  /** Wakes the runner; set once the runner exists (the queue is built first). */
  onEnqueued?: () => void
}

/** `JobQueue` port: persists through the repository, applies §18 defaults, wakes the runner. */
export const createJobQueue = ({ jobRepository, ids, clock, eventBus, onEnqueued }: Deps) => {
  let wake = onEnqueued
  const queue: JobQueue = {
    enqueue: (input) => {
      const defaults = jobDefaults[input.type]
      const output = jobRepository.enqueue({
        id: ids.next(),
        type: input.type,
        payload: input.payload,
        priority: input.priority ?? defaults.priority,
        maxAttempts: input.maxAttempts ?? defaults.maxAttempts,
        runAfter: input.runAfter ?? clock.now(),
        ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
        ...(input.mergePayload === undefined ? {} : { mergePayload: input.mergePayload }),
      })
      if (!output.deduplicated) {
        eventBus.publish('job.updated', {
          jobId: output.job.id,
          type: output.job.type,
          state: output.job.state,
          attempts: output.job.attempts,
        })
      }
      wake?.()
      return output
    },
  }
  return {
    queue,
    connectRunner: (runnerWake: () => void) => {
      wake = runnerWake
    },
  }
}
