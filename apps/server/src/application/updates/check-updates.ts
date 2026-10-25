import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import { isNewerVersion, satisfiesMinimum } from '../../core/updates/semver.ts'
import {
  type ProcessControl,
  type ReleaseSource,
  RUNTIME_PULL_COMMAND,
  type UpdateCheckRecord,
  type UpdateCheckStore,
  type UpdateStateHolder,
} from '../../core/updates/update.ts'
import { isUpdateBusy } from './state.ts'
import type { RequestUpdateCheck } from './types.ts'

export const disabledError = () =>
  appError('update/disabled', 'the updater is disabled (development, or no supervisor)')

/** Coalesces the daily check and the button (§18: `check_updates` is a singleton). */
export const CHECK_UPDATES_DEDUPE_KEY = 'check_updates'

/** `POST /admin/updates/check`. */
export const requestUpdateCheckFactory =
  ({
    jobQueue,
    processControl,
  }: {
    jobQueue: JobQueue
    processControl: ProcessControl
  }): RequestUpdateCheck =>
  () =>
    processControl.enabled
      ? ok(
          jobQueue.enqueue({
            type: 'check_updates',
            payload: {},
            dedupeKey: CHECK_UPDATES_DEDUPE_KEY,
          }).job,
        )
      : err(disabledError())

type Deps = {
  releaseSource: ReleaseSource
  checkStore: UpdateCheckStore
  notifier: AdminNotifier
  state: UpdateStateHolder
  processControl: ProcessControl
  clock: Clock
  logger: Logger
}

export type CheckUpdatesError = AppError<'update/disabled'>

/**
 * `check_updates` (§16.4): the latest release of the channel, compared to the running version;
 * its `runtimeMin` against the runtime. Raises `update/available`, or `update/runtime_too_old`
 * with the `docker pull` to run (no update offered then). An unreachable GitHub is recorded on
 * the check (shown by the admin page) rather than failing the job: an offline server would
 * otherwise notify every day.
 */
export const checkUpdatesFactory =
  ({ releaseSource, checkStore, notifier, state, processControl, clock, logger }: Deps) =>
  async (): Promise<Result<UpdateCheckRecord, CheckUpdatesError>> => {
    if (!processControl.enabled) return err(disabledError())
    const { appVersion, runtimeVersion } = processControl
    const previous = checkStore.read()
    // A check during an update (the button, the daily task) leaves its live state alone: the
    // admin page would otherwise show "available" while the download or the switch goes on.
    const setState: UpdateStateHolder['set'] = (next) => {
      if (!isUpdateBusy(state.current().state)) state.set(next)
    }
    setState({ state: 'checking' })
    const found = await releaseSource.latest({ channel: 'stable' })
    const checkedAt = clock.now()

    if (!found.ok) {
      const record: UpdateCheckRecord = {
        checkedAt,
        ...(previous?.latest === undefined ? {} : { latest: previous.latest }),
        error: { code: found.error.code, message: found.error.message },
      }
      checkStore.write(record)
      setState({ state: 'failed' })
      logger.warn('update check failed', { code: found.error.code, error: found.error })
      return ok(record)
    }

    const latest = found.value
    const record: UpdateCheckRecord = {
      checkedAt,
      ...(latest === undefined ? {} : { latest }),
    }
    checkStore.write(record)

    const superseded = previous?.latest?.version
    if (superseded !== undefined && superseded !== latest?.version) {
      notifier.resolve({ kind: 'update/available', key: superseded })
      notifier.resolve({ kind: 'update/runtime_too_old', key: superseded })
    }

    if (latest === undefined || !isNewerVersion(latest.version, appVersion)) {
      setState({ state: 'idle' })
      logger.info('no newer release', { version: appVersion, latest: latest?.version })
      return ok(record)
    }

    if (satisfiesMinimum(runtimeVersion, latest.runtimeMin)) {
      notifier.resolve({ kind: 'update/runtime_too_old', key: latest.version })
      notifier.notify({
        kind: 'update/available',
        severity: 'info',
        key: latest.version,
        context: { version: latest.version, current: appVersion },
      })
    } else {
      notifier.notify({
        kind: 'update/runtime_too_old',
        severity: 'warning',
        key: latest.version,
        context: {
          version: latest.version,
          runtimeMin: latest.runtimeMin,
          runtimeVersion,
          pullCommand: RUNTIME_PULL_COMMAND,
        },
      })
    }
    setState({ state: 'available', version: latest.version })
    logger.info('newer release found', {
      version: latest.version,
      runtimeMin: latest.runtimeMin,
      runtimeVersion,
    })
    return ok(record)
  }
