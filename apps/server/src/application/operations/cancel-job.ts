import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { JobControl, JobRepository, JobTargetLabels } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import { type JobView, jobView } from './shared/job-view.ts'

type Deps = {
  jobRepository: Pick<JobRepository, 'findById'>
  labels: JobTargetLabels
  jobControl: Pick<JobControl, 'cancel'>
  logger: Logger
}

export type CancelJobError = AppError<'job/not_found' | 'job/not_cancellable'>

export const cancelJobFactory =
  ({ jobRepository, labels, jobControl, logger }: Deps) =>
  ({ id }: { id: string }): Result<JobView, CancelJobError> => {
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
    return ok(jobView(labels, cancelled))
  }

export type CancelJob = ReturnType<typeof cancelJobFactory>
