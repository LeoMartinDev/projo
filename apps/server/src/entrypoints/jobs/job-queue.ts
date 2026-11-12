import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { IdGenerator } from '../../core/ids.ts'
import { jobDefaults } from '../../core/jobs/job.ts'
import type { JobControl, JobQueue, JobRepository } from '../../core/jobs/ports.ts'

type Deps = {
  jobRepository: JobRepository
  ids: IdGenerator
  clock: Clock
  eventBus: EventBus
  onEnqueued?: () => void
}

/**
 * The queue modules enqueue into, and the control they cancel or wake jobs with. The runner
 * needs every module's job handlers, so it is built last and connected afterwards: until then,
 * `wake` does nothing and `cancel` cancels nothing.
 */
export const createJobQueue = ({ jobRepository, ids, clock, eventBus, onEnqueued }: Deps) => {
  let wake = onEnqueued
  let runner: JobControl | undefined
  const control: JobControl = {
    cancel: (id) => runner?.cancel(id),
    wake: () => runner?.wake(),
  }
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
    control,
    connectRunner: (connected: JobControl) => {
      runner = connected
      wake = connected.wake
    },
  }
}
