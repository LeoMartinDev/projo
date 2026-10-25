import type { z } from 'zod'

import { appError, type AppError, err, type Result } from '@projo/shared'

import type { Job, JobType } from '../../core/jobs/job.ts'
import type { Logger } from '../../core/logger.ts'

export type JobContext = {
  job: Job
  /** Aborted when the job is cancelled or the server shuts down. */
  signal: AbortSignal
  /** 0..100, persisted and published as `job.updated`. Rounded; unchanged values are skipped. */
  reportProgress: (progress: number) => void
  /** Carries `jobId` and `jobType`. */
  logger: Logger
}

export type JobRunResult = Result<void, AppError>

export type JobHandler = {
  /** Max jobs of this type running at once (§18 "Concurrence"). */
  concurrency: number
  /** Optional gate, e.g. "no heavy ffmpeg job while transcoding on < 4 cores" (§18). */
  isRunnable?: () => boolean
  run: (payload: unknown, context: JobContext) => Promise<JobRunResult>
}

/** What a domain module contributes: `{ [jobType]: handler }`. */
export type JobHandlers = Partial<Record<JobType, JobHandler>>

/**
 * Builds a handler whose payload is validated by `payload` (§5.3 "every job payload goes
 * through a Zod schema"). An invalid payload fails the attempt with `job/invalid_payload`.
 */
export const defineJobHandler = <S extends z.ZodType>(definition: {
  payload: S
  concurrency: number
  isRunnable?: () => boolean
  run: (payload: z.infer<S>, context: JobContext) => Promise<JobRunResult>
}): JobHandler => ({
  concurrency: definition.concurrency,
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

/** Composition root helper. Two modules registering the same type is a bug: it throws. */
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
