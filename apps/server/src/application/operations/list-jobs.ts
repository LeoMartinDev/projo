import type { JobAdminRepository, JobListQuery, JobTargetLabels } from '../../core/jobs/ports.ts'
import { type JobView, withJobTargets } from './shared/job-view.ts'

type Deps = {
  jobAdminRepository: Pick<JobAdminRepository, 'list'>
  labels: JobTargetLabels
}

export const listJobsFactory =
  ({ jobAdminRepository, labels }: Deps) =>
  (query: JobListQuery): { items: JobView[]; nextCursor?: string } => {
    const page = jobAdminRepository.list(query)
    return {
      items: withJobTargets(labels, page.items),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    }
  }

export type ListJobs = ReturnType<typeof listJobsFactory>
