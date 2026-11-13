import { appError } from '@projo/shared'

import type { UpdateRepository, UpdateStateHolder } from '../../../core/updates/update.ts'
import { isUpdateBusy } from '../update-state-holder.ts'

export const disabledError = () =>
  appError('update/disabled', 'the updater is disabled (development, or no supervisor)')

export const inProgress = () => appError('update/in_progress', 'an update is already in progress')

export const alreadyCurrent = (version: string) =>
  appError('update/already_current', 'this version is already running', { context: { version } })

export const runtimeTooOld = (version: string, runtimeMin: string, runtimeVersion: string) =>
  appError('update/runtime_too_old', 'this version needs a newer runtime image', {
    context: { version, runtimeMin, runtimeVersion },
  })

/** An update or a rollback is under way, live or waiting for the switch. */
export const isBusy = (state: UpdateStateHolder, repository: UpdateRepository): boolean =>
  isUpdateBusy(state.current().state) || repository.pendingRun() !== undefined
