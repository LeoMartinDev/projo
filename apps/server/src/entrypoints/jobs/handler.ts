import type { z } from 'zod'

import { appError, type AppError, err, type Result } from '@projo/shared'

import { type Job, type JobPayloads, type JobType, jobTypes } from '../../core/jobs/job.ts'
import type { Logger } from '../../core/logger.ts'

export type JobContext = {
  job: Job
  signal: AbortSignal
  reportProgress: (progress: number) => void
  logger: Logger
}

export type JobRunResult = Result<void, AppError>

export const concurrencyGroups = { heavy_ffmpeg: 1 } as const
export type ConcurrencyGroup = keyof typeof concurrencyGroups

/** What the runner sees: the stored payload is unknown until the handler's schema parses it. */
export type JobHandler = {
  concurrency: number
  group?: ConcurrencyGroup
  isRunnable?: () => boolean
  run: (payload: unknown, context: JobContext) => Promise<JobRunResult>
}

export type JobHandlers = Partial<Record<JobType, JobHandler>>

export type JobHandlerDefinition<T extends JobType> = {
  /** Parses the stored payload; its output must be the job type's payload (`JobPayloads`). */
  payload: z.ZodType<JobPayloads[T]>
  concurrency: number
  group?: ConcurrencyGroup
  isRunnable?: () => boolean
  run: (payload: JobPayloads[T], context: JobContext) => Promise<JobRunResult>
}

export type JobHandlerDefinitions = { [T in JobType]?: JobHandlerDefinition<T> }

const toJobHandler = <T extends JobType>(definition: JobHandlerDefinition<T>): JobHandler => ({
  concurrency: definition.concurrency,
  ...(definition.group === undefined ? {} : { group: definition.group }),
  ...(definition.isRunnable === undefined ? {} : { isRunnable: definition.isRunnable }),
  run: async (payload, context) => {
    const parsed = definition.payload.safeParse(payload)
    if (!parsed.success) {
      return err(
        appError('job/invalid_payload', 'job payload does not match its schema', {
          context: { jobType: context.job.type, issues: parsed.error.issues },
        }),
      )
    }
    return definition.run(parsed.data, context)
  },
})

/**
 * The input direction of the schema check: every payload `JobQueue.enqueue` takes for a type must
 * parse (`z.ZodType<JobPayloads[T]>` only checks what the schema yields). A key that is not a job
 * type maps to `never`.
 */
type AcceptsJobPayloads<D> = {
  [K in keyof D]: K extends JobType
    ? D[K] extends { payload: infer S extends z.ZodType }
      ? [JobPayloads[K]] extends [z.input<S>]
        ? unknown
        : { payload: `the schema of ${K} must accept JobPayloads['${K}']` }
      : unknown
    : never
}

/**
 * Handlers keyed by job type. Each `payload` schema must accept the job type's payload
 * (`JobPayloads`) and yield it, `run` receives it; a key that is not a job type does not compile.
 */
export const defineJobHandlers = <D extends JobHandlerDefinitions>(
  definitions: D & AcceptsJobPayloads<D>,
): { [T in keyof D & JobType]: JobHandler } => {
  const all: JobHandlerDefinitions = definitions
  const handlers: JobHandlers = {}
  const add = <T extends JobType>(type: T): void => {
    const definition = all[type]
    if (definition !== undefined) handlers[type] = toJobHandler(definition)
  }
  for (const type of jobTypes) add(type)
  return handlers as { [T in keyof D & JobType]: JobHandler }
}

export const mergeJobHandlers = (...groups: (JobHandlers | undefined)[]): JobHandlers => {
  const merged: JobHandlers = {}
  for (const group of groups) {
    if (group === undefined) continue
    for (const [type, handler] of Object.entries(group) as [JobType, JobHandler][]) {
      if (merged[type] !== undefined) throw new Error(`job handler registered twice: ${type}`)
      merged[type] = handler
    }
  }
  return merged
}

/** Startup invariant: a job type without a handler would stay `queued` forever. */
export const requireAllJobHandlers = (handlers: JobHandlers): JobHandlers => {
  const missing = jobTypes.filter((type) => handlers[type] === undefined)
  if (missing.length > 0) throw new Error(`job types without a handler: ${missing.join(', ')}`)
  return handlers
}
