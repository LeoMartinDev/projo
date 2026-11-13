import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type {
  JobAdminRepository,
  JobControl,
  JobRepository,
  JobTargetLabels,
} from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import { type JobView, jobView } from './shared/job-view.ts'

type Deps = {
  jobAdminRepository: Pick<JobAdminRepository, 'retry'>
  jobRepository: Pick<JobRepository, 'findById'>
  labels: JobTargetLabels
  jobControl: Pick<JobControl, 'wake'>
  clock: Clock
  eventBus: EventBus
  logger: Logger
}

export type RetryJobError = AppError<'job/not_found' | 'job/not_retryable'>

export const retryJobFactory =
  ({ jobAdminRepository, jobRepository, labels, jobControl, clock, eventBus, logger }: Deps) =>
  ({ id }: { id: string }): Result<JobView, RetryJobError> => {
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
    return ok(jobView(labels, retried))
  }

export type RetryJob = ReturnType<typeof retryJobFactory>
