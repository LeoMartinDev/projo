import { isNewerVersion, satisfiesMinimum } from '../../core/updates/semver.ts'
import type {
  ProcessControl,
  ReleaseInstaller,
  UpdateCheckStore,
  UpdateRepository,
  UpdateStateHolder,
} from '../../core/updates/update.ts'
import type { GetUpdatesStatus } from './types.ts'

export const RECENT_RUNS_LIMIT = 20

export const getUpdatesStatusFactory =
  ({
    processControl,
    repository,
    checkStore,
    installer,
    state,
  }: {
    processControl: ProcessControl
    repository: UpdateRepository
    checkStore: UpdateCheckStore
    installer: ReleaseInstaller
    state: UpdateStateHolder
  }): GetUpdatesStatus =>
  async () => {
    const { enabled, appVersion, runtimeVersion } = processControl
    const lastCheck = checkStore.read()
    const latest = lastCheck?.latest
    const onDisk = new Map(
      (await installer.installed()).map((entry) => [entry.version, entry.manifest] as const),
    )
    const versions = repository
      .versions()
      .filter((row) => row.version === appVersion || onDisk.has(row.version))
      .map((row) => {
        const manifest = onDisk.get(row.version)
        return {
          ...row,
          canSwitch:
            enabled &&
            row.version !== appVersion &&
            row.state !== 'failed' &&
            manifest !== undefined &&
            satisfiesMinimum(runtimeVersion, manifest.runtimeMin),
        }
      })
    const live = state.current()
    return {
      enabled,
      current: { version: appVersion, runtime: runtimeVersion },
      state: live.state,
      ...(live.progress === undefined ? {} : { progress: live.progress }),
      ...(lastCheck === undefined ? {} : { lastCheck }),
      ...(latest === undefined || !isNewerVersion(latest.version, appVersion)
        ? {}
        : {
            available: {
              ...latest,
              runtimeCompatible: satisfiesMinimum(runtimeVersion, latest.runtimeMin),
            },
          }),
      versions,
      runs: repository.recentRuns(RECENT_RUNS_LIMIT),
    }
  }
