import type { Job } from '../../core/jobs/job.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'

export const notifyJobFailureFactory =
  ({ notifier }: { notifier: AdminNotifier }) =>
  (job: Job): void => {
    if (job.type === 'apply_update' && job.error?.code.startsWith('update/') === true) return
    // A TV source counts its own failures and raises `tv/source_unreachable` (§29.2).
    if (job.type === 'refresh_tv_source' && job.error?.code.startsWith('tv/') === true) return
    notifier.notify({
      kind: 'job/failed',
      severity: 'error',
      key: `${job.type}:${job.error?.code ?? 'unknown'}`,
      context: {
        jobId: job.id,
        jobType: job.type,
        attempts: job.attempts,
        ...(job.error === undefined ? {} : { code: job.error.code, message: job.error.message }),
      },
    })
  }
