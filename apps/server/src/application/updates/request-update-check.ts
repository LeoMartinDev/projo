import { type AppError, err, ok, type Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { ProcessControl } from '../../core/updates/update.ts'
import { disabledError } from './shared/update-guards.ts'

type Deps = {
  jobQueue: JobQueue
  processControl: ProcessControl
}

export const CHECK_UPDATES_DEDUPE_KEY = 'check_updates'

export type RequestUpdateCheckError = AppError<'update/disabled'>

export const requestUpdateCheckFactory =
  ({ jobQueue, processControl }: Deps) =>
  (): Result<Job, RequestUpdateCheckError> =>
    processControl.enabled
      ? ok(
          jobQueue.enqueue({
            type: 'check_updates',
            payload: {},
            dedupeKey: CHECK_UPDATES_DEDUPE_KEY,
          }).job,
        )
      : err(disabledError())

export type RequestUpdateCheck = ReturnType<typeof requestUpdateCheckFactory>
