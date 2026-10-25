import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import { isNewerVersion, satisfiesMinimum } from '../../core/updates/semver.ts'
import type {
  InstallReleaseError,
  ProcessControl,
  ReleaseInstaller,
  UpdateCheckStore,
  UpdateRepository,
  UpdateRun,
  UpdateStateHolder,
} from '../../core/updates/update.ts'
import { disabledError } from './check-updates.ts'
import { isUpdateBusy } from './state.ts'
import type { RequestRollback, RequestUpdate } from './types.ts'

/** One `apply_update` at a time (§18: singleton). */
export const APPLY_UPDATE_DEDUPE_KEY = 'apply_update'

/** An update is downloading, waiting for its switch, or a switch was requested. */
const isBusy = (state: UpdateStateHolder, repository: UpdateRepository): boolean =>
  isUpdateBusy(state.current().state) || repository.pendingRun() !== undefined

const inProgress = () => appError('update/in_progress', 'an update is already in progress')
const alreadyCurrent = (version: string) =>
  appError('update/already_current', 'this version is already running', { context: { version } })
const runtimeTooOld = (version: string, runtimeMin: string, runtimeVersion: string) =>
  appError('update/runtime_too_old', 'this version needs a newer runtime image', {
    context: { version, runtimeMin, runtimeVersion },
  })

/** `POST /admin/updates/apply`: the version shown as available, then `apply_update`. */
export const requestUpdateFactory =
  ({
    jobQueue,
    checkStore,
    repository,
    state,
    processControl,
  }: {
    jobQueue: JobQueue
    checkStore: UpdateCheckStore
    repository: UpdateRepository
    state: UpdateStateHolder
    processControl: ProcessControl
  }): RequestUpdate =>
  ({ version }) => {
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

type ApplyDeps = {
  installer: ReleaseInstaller
  repository: UpdateRepository
  checkStore: UpdateCheckStore
  state: UpdateStateHolder
  processControl: ProcessControl
  notifier: AdminNotifier
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type ApplyUpdateError =
  InstallReleaseError | AppError<'update/disabled' | 'update/not_found' | 'update/runtime_too_old'>

/**
 * `apply_update` (§16.4): download, `SHA256SUMS` and manifest checks, `versions/<v>`, `pending`,
 * then the exit 75. The job ends `done` (the runner completes it during the clean stop) and the
 * run stays `pending` until the restarted app reads the supervisor's report.
 */
export const applyUpdateFactory =
  ({
    installer,
    repository,
    checkStore,
    state,
    processControl,
    notifier,
    clock,
    ids,
    logger,
  }: ApplyDeps) =>
  async ({
    version,
    signal,
    reportProgress,
  }: {
    version: string
    signal: AbortSignal
    reportProgress: (percent: number) => void
  }): Promise<Result<void, ApplyUpdateError>> => {
    const { enabled, appVersion, runtimeVersion } = processControl
    if (!enabled) return err(disabledError())
    const release = checkStore.read()?.latest
    if (release === undefined || release.version !== version)
      return err(
        appError('update/not_found', 'this version is not the available release', {
          context: { version },
        }),
      )
    if (!satisfiesMinimum(runtimeVersion, release.runtimeMin))
      return err(runtimeTooOld(version, release.runtimeMin, runtimeVersion))

    const run = repository.startRun({
      id: ids.next(),
      kind: 'update',
      fromVersion: appVersion,
      toVersion: version,
      requestedAt: clock.now(),
    })
    const failRun = <E extends ApplyUpdateError>(error: E): Result<void, E> => {
      repository.finishRun({
        id: run.id,
        outcome: 'failed',
        finishedAt: clock.now(),
        error: { code: error.code, message: error.message },
      })
      state.set({ state: 'failed', version })
      // Interrupted by a stop or a cancel: the job runs again or was cancelled on purpose.
      if (!signal.aborted)
        notifier.notify({
          kind: 'update/failed',
          severity: 'error',
          key: run.id,
          context: { version, code: error.code, message: error.message },
        })
      logger.error('update failed', { code: error.code, version, error })
      return err(error)
    }

    state.set({ state: 'downloading', version, progress: 0 })
    logger.info('update started', { from: appVersion, to: version })
    const installed = await installer.install({
      release,
      signal,
      onProgress: (percent) => {
        reportProgress(percent)
        state.set({ state: 'downloading', version, progress: percent })
      },
    })
    if (!installed.ok) return failRun(installed.error)
    repository.upsertVersion({
      version,
      state: 'staged',
      installedAt: clock.now(),
      runtimeMin: installed.value.runtimeMin,
    })

    state.set({ state: 'applying', version })
    const pending = await installer.writePending(version)
    if (!pending.ok) return failRun(pending.error)

    state.set({ state: 'restarting', version })
    logger.info('restarting for the switch', { from: appVersion, to: version, runId: run.id })
    processControl.exitForSwitch()
    return ok(undefined)
  }

/**
 * `POST /admin/updates/rollback` (§16.4 "Go back to this version"): the same switch towards a
 * version already on the disk (checked against its manifest).
 */
export const requestRollbackFactory =
  ({
    installer,
    repository,
    state,
    processControl,
    clock,
    ids,
    logger,
  }: Omit<ApplyDeps, 'checkStore' | 'notifier'>): RequestRollback =>
  async ({ version }) => {
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
