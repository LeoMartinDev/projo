import type { AppError, Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type {
  AppVersion,
  Release,
  UpdateCheckRecord,
  UpdateRun,
  UpdateState,
} from '../../core/updates/update.ts'

/**
 * The use cases the update routes and jobs call (§16.4, §17.2). Built by
 * `entrypoints/modules/updates.ts`.
 */

export type UpdatesStatus = {
  enabled: boolean
  current: { version: string; runtime: string }
  state: UpdateState
  progress?: number
  lastCheck?: UpdateCheckRecord
  /** The latest release when newer than the running version. */
  available?: Release & { runtimeCompatible: boolean }
  /** `app_versions` with whether a switch to each is possible (on disk, valid, runtime fits). */
  versions: (AppVersion & { canSwitch: boolean })[]
  runs: UpdateRun[]
}

/** `GET /admin/updates`. */
export type GetUpdatesStatus = () => Promise<UpdatesStatus>

/** `POST /admin/updates/check`: enqueues `check_updates` (singleton, dedupe `check_updates`). */
export type RequestUpdateCheck = () => Result<Job, AppError<'update/disabled'>>

export type RequestUpdateError = AppError<
  | 'update/disabled'
  | 'update/not_found'
  | 'update/already_current'
  | 'update/runtime_too_old'
  | 'update/in_progress'
>

/** `POST /admin/updates/apply`: enqueues `apply_update` for the available version. */
export type RequestUpdate = (input: { version: string }) => Result<Job, RequestUpdateError>

/**
 * `POST /admin/updates/rollback`: a version present on the disk. Starts an `update_runs` row
 * (`rollback`), writes `pending`, then asks the process to exit 75 once the response is sent.
 */
export type RequestRollback = (input: {
  version: string
}) => Promise<Result<{ version: string }, RequestUpdateError | AppError<'update/install_failed'>>>

/**
 * Startup (§16.3): settles what the last switch left (supervisor's `switch-result.json`, the
 * `pending` run, `app_versions`, notifications `update/rolled_back`, `update/available` resolved).
 */
export type ReconcileAfterSwitch = () => Promise<void>
