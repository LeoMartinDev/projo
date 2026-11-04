import type { z } from 'zod'

import { appError, type AppError, err, type Result } from '@projo/shared'

import type { Job, JobType } from '../../core/jobs/job.ts'
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

export type JobHandler = {
  concurrency: number
  group?: ConcurrencyGroup
  isRunnable?: () => boolean
  run: (payload: unknown, context: JobContext) => Promise<JobRunResult>
}

export type JobHandlers = Partial<Record<JobType, JobHandler>>

export const defineJobHandler = <S extends z.ZodType>(definition: {
  payload: S
  concurrency: number
  group?: ConcurrencyGroup
  isRunnable?: () => boolean
  run: (payload: z.infer<S>, context: JobContext) => Promise<JobRunResult>
}): JobHandler => ({
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
