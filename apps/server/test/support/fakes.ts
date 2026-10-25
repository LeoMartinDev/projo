import type { EventBus, EventListener, ServerEvent } from '../../src/core/events.ts'
import type { IdGenerator } from '../../src/core/ids.ts'
import { jobDefaults, type Job } from '../../src/core/jobs/job.ts'
import type { EnqueueJobInput, JobQueue } from '../../src/core/jobs/ports.ts'

/** Deterministic ids: `id-1`, `id-2`… (or with a custom prefix). */
export const createSequentialIds = (prefix = 'id-'): IdGenerator => {
  let counter = 0
  return {
    next: () => {
      counter += 1
      return `${prefix}${counter}`
    },
  }
}

/** EventBus keeping every published event in `events`. */
export const createRecordingEventBus = () => {
  const events: ServerEvent[] = []
  const listeners = new Set<EventListener>()
  const bus: EventBus = {
    publish: (type, payload) => {
      const event = { type, payload } as ServerEvent
      events.push(event)
      for (const listener of listeners) listener(event)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return { bus, events }
}

/** JobQueue keeping every enqueue in `enqueued`; dedupes on `dedupeKey` like the real one. */
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
