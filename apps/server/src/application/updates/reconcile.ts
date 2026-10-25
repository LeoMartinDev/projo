import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import { isNewerVersion } from '../../core/updates/semver.ts'
import type {
  AppVersion,
  ProcessControl,
  ReleaseInstaller,
  UpdateCheckStore,
  UpdateRepository,
  UpdateRun,
  UpdateStateHolder,
} from '../../core/updates/update.ts'
import type { ReconcileAfterSwitch } from './types.ts'

type Deps = {
  installer: ReleaseInstaller
  repository: UpdateRepository
  checkStore: UpdateCheckStore
  notifier: AdminNotifier
  state: UpdateStateHolder
  processControl: ProcessControl
  clock: Clock
  logger: Logger
}

/**
 * Startup (§16.3): settles what the last switch left. The supervisor's `switch-result.json`
 * closes the pending run (`succeeded`, or `rolled_back` with the `update/rolled_back`
 * notification and the refused version `failed`); a pending run without report means the switch
 * never happened. Then `app_versions` follows the disk and the running version, and the
 * notifications about the version now running are resolved.
 */
export const reconcileAfterSwitchFactory =
  ({
    installer,
    repository,
    checkStore,
    notifier,
    state,
    processControl,
    clock,
    logger,
  }: Deps): ReconcileAfterSwitch =>
  async () => {
    // Read before any await: the job runner starts meanwhile and may open a new run.
    const now = clock.now()
    const pending = repository.pendingRun()
    const { appVersion } = processControl
    const report = await installer.takeSwitchReport()
    const installed = await installer.installed()
    const runtimeMinOf = (version: string): string | undefined =>
      installed.find((entry) => entry.version === version)?.manifest.runtimeMin ??
      repository.versions().find((row) => row.version === version)?.runtimeMin

    // The pending run the report settles, if any.
    let run: UpdateRun | undefined
    if (report !== undefined) {
      run = pending?.toVersion === report.toVersion ? pending : undefined
      if (report.outcome === 'switched') {
        if (run !== undefined)
          repository.finishRun({ id: run.id, outcome: 'succeeded', finishedAt: report.at })
        logger.info('version switch succeeded', {
          from: report.fromVersion,
          to: report.toVersion,
        })
      } else {
        if (run !== undefined)
          repository.finishRun({ id: run.id, outcome: 'rolled_back', finishedAt: report.at })
        const refused = repository.versions().find((row) => row.version === report.toVersion)
        const runtimeMin = refused?.runtimeMin ?? runtimeMinOf(report.toVersion)
        if (runtimeMin !== undefined)
          repository.upsertVersion({
            version: report.toVersion,
            state: 'failed',
            installedAt: refused?.installedAt ?? now,
            runtimeMin,
          })
        notifier.notify({
          kind: 'update/rolled_back',
          severity: 'error',
          key: run?.id ?? `${report.toVersion}@${report.at.toISOString()}`,
          context: {
            from: report.fromVersion,
            to: report.toVersion,
            ...(report.reason === undefined ? {} : { reason: report.reason }),
          },
        })
        logger.error('version switch rolled back', {
          code: 'update/rolled_back',
          from: report.fromVersion,
          to: report.toVersion,
          reason: report.reason,
        })
      }
    }

    // A run still pending: the process restarted without the supervisor switching.
    const stale = run === undefined ? pending : undefined
    if (stale !== undefined) {
      const reached = stale.toVersion === appVersion
      repository.finishRun({
        id: stale.id,
        outcome: reached ? 'succeeded' : 'failed',
        finishedAt: now,
        ...(reached
          ? {}
          : {
              error: {
                code: 'update/install_failed',
                message: 'the server restarted without switching version',
              },
            }),
      })
    }

    // `app_versions`: the running version is current, the one it replaced previous; versions
    // found on the disk (the image's seed, an older install) are recorded.
    const rows = new Map(repository.versions().map((row) => [row.version, row] as const))
    for (const row of rows.values()) {
      if (row.state === 'current' && row.version !== appVersion)
        repository.setVersionState({ version: row.version, state: 'previous' })
    }
    const runtimeMin = runtimeMinOf(appVersion)
    if (runtimeMin !== undefined)
      repository.upsertVersion({
        version: appVersion,
        state: 'current',
        installedAt: rows.get(appVersion)?.installedAt ?? now,
        runtimeMin,
      })
    for (const entry of installed) {
      if (rows.has(entry.version) || entry.version === appVersion) continue
      const found: AppVersion = {
        version: entry.version,
        state: isNewerVersion(entry.version, appVersion) ? 'staged' : 'previous',
        installedAt: now,
        runtimeMin: entry.manifest.runtimeMin,
      }
      repository.upsertVersion(found)
    }

    notifier.resolve({ kind: 'update/available', key: appVersion })
    notifier.resolve({ kind: 'update/runtime_too_old', key: appVersion })

    // Unless a job already moved it on (a check or an update resumed by the runner).
    if (state.current().state !== 'idle') return
    const latest = checkStore.read()?.latest
    state.set(
      latest !== undefined && isNewerVersion(latest.version, appVersion)
        ? { state: 'available', version: latest.version }
        : { state: 'idle' },
    )
  }
