import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import { isNewerVersion, satisfiesMinimum } from '../../core/updates/semver.ts'
import type {
  ProcessControl,
  UpdateCheckStore,
  UpdateRepository,
  UpdateStateHolder,
} from '../../core/updates/update.ts'
import {
  alreadyCurrent,
  disabledError,
  inProgress,
  isBusy,
  runtimeTooOld,
} from './shared/update-guards.ts'

type Deps = {
  jobQueue: JobQueue
  checkStore: UpdateCheckStore
  repository: UpdateRepository
  state: UpdateStateHolder
  processControl: ProcessControl
}

export const APPLY_UPDATE_DEDUPE_KEY = 'apply_update'

export type RequestUpdateError = AppError<
  | 'update/disabled'
  | 'update/not_found'
  | 'update/already_current'
  | 'update/runtime_too_old'
  | 'update/in_progress'
>

export const requestUpdateFactory =
  ({ jobQueue, checkStore, repository, state, processControl }: Deps) =>
  ({ version }: { version: string }): Result<Job, RequestUpdateError> => {
    const { enabled, appVersion, runtimeVersion } = processControl
    if (!enabled) return err(disabledError())
    if (version === appVersion) return err(alreadyCurrent(version))
    const latest = checkStore.read()?.latest
    if (latest === undefined || latest.version !== version || !isNewerVersion(version, appVersion))
      return err(
        appError('update/not_found', 'this version is not the available release', {
          context: { version },
        }),
      )
    if (!satisfiesMinimum(runtimeVersion, latest.runtimeMin))
      return err(runtimeTooOld(version, latest.runtimeMin, runtimeVersion))
    if (isBusy(state, repository)) return err(inProgress())
    const { job, deduplicated } = jobQueue.enqueue({
      type: 'apply_update',
      payload: { version },
      dedupeKey: APPLY_UPDATE_DEDUPE_KEY,
    })
    return deduplicated ? err(inProgress()) : ok(job)
  }

export type RequestUpdate = ReturnType<typeof requestUpdateFactory>
