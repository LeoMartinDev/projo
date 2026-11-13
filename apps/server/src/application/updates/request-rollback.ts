import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import { satisfiesMinimum } from '../../core/updates/semver.ts'
import type {
  ProcessControl,
  ReleaseInstaller,
  UpdateRepository,
  UpdateRun,
  UpdateStateHolder,
} from '../../core/updates/update.ts'
import type { RequestUpdateError } from './request-update.ts'
import {
  alreadyCurrent,
  disabledError,
  inProgress,
  isBusy,
  runtimeTooOld,
} from './shared/update-guards.ts'

type Deps = {
  installer: ReleaseInstaller
  repository: UpdateRepository
  state: UpdateStateHolder
  processControl: ProcessControl
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type RequestRollbackError = RequestUpdateError | AppError<'update/install_failed'>

export const requestRollbackFactory =
  ({ installer, repository, state, processControl, clock, ids, logger }: Deps) =>
  async ({
    version,
  }: {
    version: string
  }): Promise<Result<{ version: string }, RequestRollbackError>> => {
    const { enabled, appVersion, runtimeVersion } = processControl
    if (!enabled) return err(disabledError())
    if (version === appVersion) return err(alreadyCurrent(version))
    if (isBusy(state, repository)) return err(inProgress())
    const target = (await installer.installed()).find((entry) => entry.version === version)
    if (target === undefined)
      return err(
        appError('update/not_found', 'this version is not installed on the disk', {
          context: { version },
        }),
      )
    if (!satisfiesMinimum(runtimeVersion, target.manifest.runtimeMin))
      return err(runtimeTooOld(version, target.manifest.runtimeMin, runtimeVersion))

    const run: UpdateRun = repository.startRun({
      id: ids.next(),
      kind: 'rollback',
      fromVersion: appVersion,
      toVersion: version,
      requestedAt: clock.now(),
    })
    state.set({ state: 'applying', version })
    const pending = await installer.writePending(version)
    if (!pending.ok) {
      repository.finishRun({
        id: run.id,
        outcome: 'failed',
        finishedAt: clock.now(),
        error: { code: pending.error.code, message: pending.error.message },
      })
      state.set({ state: 'failed', version })
      return err(pending.error)
    }
    state.set({ state: 'restarting', version })
    logger.info('restarting for a rollback', { from: appVersion, to: version, runId: run.id })
    processControl.exitForSwitch()
    return ok({ version })
  }

export type RequestRollback = ReturnType<typeof requestRollbackFactory>
