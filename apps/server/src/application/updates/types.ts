import type { AppError, Result } from '@projo/shared'

import type { Job } from '../../core/jobs/job.ts'
import type {
  AppVersion,
  Release,
  UpdateCheckRecord,
  UpdateRun,
  UpdateState,
} from '../../core/updates/update.ts'

export type UpdatesStatus = {
  enabled: boolean
  current: { version: string; runtime: string }
  state: UpdateState
  progress?: number
  lastCheck?: UpdateCheckRecord
  available?: Release & { runtimeCompatible: boolean }
  versions: (AppVersion & { canSwitch: boolean })[]
  runs: UpdateRun[]
}

export type GetUpdatesStatus = () => Promise<UpdatesStatus>

export type RequestUpdateCheck = () => Result<Job, AppError<'update/disabled'>>

export type RequestUpdateError = AppError<
  | 'update/disabled'
  | 'update/not_found'
  | 'update/already_current'
  | 'update/runtime_too_old'
  | 'update/in_progress'
>

export type RequestUpdate = (input: { version: string }) => Result<Job, RequestUpdateError>

export type RequestRollback = (input: {
  version: string
}) => Promise<Result<{ version: string }, RequestUpdateError | AppError<'update/install_failed'>>>

export type ReconcileAfterSwitch = () => Promise<void>
