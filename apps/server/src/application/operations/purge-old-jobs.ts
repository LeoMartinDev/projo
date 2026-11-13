import type { Clock } from '../../core/clock.ts'
import { DONE_JOB_RETENTION_MS, FAILED_JOB_RETENTION_MS } from '../../core/jobs/job.ts'
import type { JobRepository } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  jobRepository: Pick<JobRepository, 'purgeFinished'>
  clock: Clock
  logger: Logger
}

export const purgeOldJobsFactory =
  ({ jobRepository, clock, logger }: Deps) =>
  (): { deleted: number } => {
    const now = clock.now().getTime()
    const deleted = jobRepository.purgeFinished({
      doneBefore: new Date(now - DONE_JOB_RETENTION_MS),
      failedBefore: new Date(now - FAILED_JOB_RETENTION_MS),
    })
    if (deleted > 0) logger.info('old jobs purged', { deleted })
    return { deleted }
  }

export type PurgeOldJobs = ReturnType<typeof purgeOldJobsFactory>
