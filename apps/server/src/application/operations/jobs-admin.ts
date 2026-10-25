import { appError, err, ok } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { Job } from '../../core/jobs/job.ts'
import {
  type JobAdminRepository,
  type JobControl,
  type JobRepository,
  type JobTargetLabels,
  type JobTargetRef,
  jobTargetKey,
} from '../../core/jobs/ports.ts'
import { jobTargetOf } from '../../core/jobs/target.ts'
import type { Logger } from '../../core/logger.ts'
import type { JobsAdmin, JobView } from './types.ts'

type Deps = {
  jobAdminRepository: JobAdminRepository
  jobRepository: Pick<JobRepository, 'findById'>
  labels: JobTargetLabels
  jobControl: JobControl
  clock: Clock
  eventBus: EventBus
  logger: Logger
}

/**
 * §15 "Jobs": the list with each job's target ("cible", named when it still exists), "Relancer"
 * (a `failed` or `cancelled` job back to `queued`, attempts reset) and "Undo" (through the
 * runner, which aborts a running job).
 */
export const jobsAdminFactory = ({
  jobAdminRepository,
  jobRepository,
  labels,
  jobControl,
  clock,
  eventBus,
  logger,
}: Deps): JobsAdmin => {
  const withTargets = (jobs: readonly Job[]): JobView[] => {
    const targets = new Map<string, JobTargetRef>()
    for (const job of jobs) {
      const target = jobTargetOf(job.type, job.payload)
      if (target !== undefined) targets.set(job.id, target)
    }
    const names = labels.labelsOf([...targets.values()])
    return jobs.map((job) => {
      const target = targets.get(job.id)
      if (target === undefined) return job
      const name = names.get(jobTargetKey(target))
      return { ...job, target: name === undefined ? target : { ...target, ...name } }
    })
  }
  const one = (job: Job): JobView => withTargets([job])[0] ?? job

  return {
    list: (query) => {
      const page = jobAdminRepository.list(query)
      return {
        items: withTargets(page.items),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }
    },

    retry: ({ id }) => {
      if (jobRepository.findById(id) === undefined)
        return err(appError('job/not_found', 'job not found', { context: { id } }))
      const retried = jobAdminRepository.retry({ id, now: clock.now() })
      if (retried === undefined)
        return err(
          appError('job/not_retryable', 'only a failed or cancelled job can be retried', {
            context: { id },
          }),
        )
      eventBus.publish('job.updated', {
        jobId: retried.id,
        type: retried.type,
        state: retried.state,
        attempts: retried.attempts,
      })
      jobControl.wake()
      logger.info('job retried by an admin', { jobId: id, jobType: retried.type })
      return ok(one(retried))
    },

    cancel: ({ id }) => {
      if (jobRepository.findById(id) === undefined)
        return err(appError('job/not_found', 'job not found', { context: { id } }))
      const cancelled = jobControl.cancel(id)
      if (cancelled === undefined)
        return err(
          appError('job/not_cancellable', 'only a queued or running job can be cancelled', {
            context: { id },
          }),
        )
      logger.info('job cancelled by an admin', { jobId: id, jobType: cancelled.type })
      return ok(one(cancelled))
    },
  }
}
