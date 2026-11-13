import type { Job } from '../../../core/jobs/job.ts'
import {
  type JobTargetItem,
  type JobTargetLabels,
  type JobTargetRef,
  jobTargetKey,
} from '../../../core/jobs/ports.ts'
import { jobTargetOf } from '../../../core/jobs/target.ts'

export type JobTarget = JobTargetRef & { label?: string; item?: JobTargetItem }

export type JobView = Job & { target?: JobTarget }

/** Jobs with what they work on, named when it still exists. */
export const withJobTargets = (labels: JobTargetLabels, jobs: readonly Job[]): JobView[] => {
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

export const jobView = (labels: JobTargetLabels, job: Job): JobView =>
  withJobTargets(labels, [job])[0] ?? job
