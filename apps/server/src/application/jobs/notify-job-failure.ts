import type { Job } from '../../core/jobs/job.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'

/**
 * §18 "A job that fails on its last attempt creates a notification with the error code":
 * the runner's `onFinalFailure`. One notification per job (`job/failed`, keyed by its id).
 */
export const notifyJobFailureFactory =
  ({ notifier }: { notifier: AdminNotifier }) =>
  (job: Job): void => {
    // `apply_update` raises its own `update/failed` for the update errors (§16.4).
    if (job.type === 'apply_update' && job.error?.code.startsWith('update/') === true) return
    notifier.notify({
      kind: 'job/failed',
      severity: 'error',
      key: job.id,
      context: {
        jobId: job.id,
        jobType: job.type,
        attempts: job.attempts,
        ...(job.error === undefined ? {} : { code: job.error.code, message: job.error.message }),
      },
    })
  }
