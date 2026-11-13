import { ok } from '@projo/shared'

import { createUpdateStateHolder } from '../../src/application/updates/update-state-holder.ts'
import type { AdminNotifier } from '../../src/core/notifications/notifier.ts'
import type {
  AppVersion,
  ProcessControl,
  Release,
  ReleaseInstaller,
  ReleaseManifest,
  SwitchReport,
  UpdateCheckRecord,
  UpdateCheckStore,
  UpdateRepository,
  UpdateRun,
} from '../../src/core/updates/update.ts'
import { createManualClock } from './clock.ts'
import { createRecordingEventBus, createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

export const release = (version: string, runtimeMin = '0.1.0'): Release => ({
  version,
  tag: `v${version}`,
  publishedAt: new Date('2026-10-24T09:00:00.000Z'),
  notes: '',
  url: `https://github.com/LeoMartinDev/projo/releases/tag/v${version}`,
  archive: { name: `projo-app-${version}.tar.gz`, url: 'https://github.com/a', sizeBytes: 1 },
  checksums: { name: 'SHA256SUMS', url: 'https://github.com/b', sizeBytes: 1 },
  runtimeMin,
})

export const manifest = (version: string): ReleaseManifest => ({
  version,
  runtimeMin: '0.1.0',
  builtAt: new Date('2026-10-24T00:00:00.000Z'),
  files: { 'server.js': 'a'.repeat(64) },
})

const inMemoryRepository = () => {
  const versions = new Map<string, AppVersion>()
  const runs: UpdateRun[] = []
  const repository: UpdateRepository = {
    versions: () => [...versions.values()],
    upsertVersion: (version) => void versions.set(version.version, version),
    setVersionState: ({ version, state }) => {
      const row = versions.get(version)
      if (row !== undefined) versions.set(version, { ...row, state })
    },
    startRun: (run) => {
      const started: UpdateRun = { ...run, outcome: 'pending' }
      runs.unshift(started)
      return started
    },
    finishRun: ({ id, ...rest }) => {
      const index = runs.findIndex((run) => run.id === id)
      const run = runs[index]
      if (run === undefined) return undefined
      runs[index] = { ...run, ...rest }
      return runs[index]
    },
    pendingRun: () => runs.find((run) => run.outcome === 'pending'),
    recentRuns: (limit) => runs.slice(0, limit),
  }
  return { repository, runs, versions }
}

const recordingNotifierCalls = () => {
  const notified: { kind: string; key: string }[] = []
  const resolved: { kind: string; key: string }[] = []
  const notifier: AdminNotifier = {
    notify: ({ kind, key }) => void notified.push({ kind, key }),
    resolve: ({ kind, key }) => void resolved.push({ kind, key }),
  }
  return { notifier, notified, resolved }
}

/** The dependencies of the update use cases, in memory, running `appVersion` under a supervisor. */
export const createUpdateUseCasesWorld = ({
  appVersion = '1.3.0',
  installer: installerOverrides = {},
  latest,
}: {
  appVersion?: string
  installer?: Partial<ReleaseInstaller>
  latest?: Release
} = {}) => {
  const clock = createManualClock(new Date('2026-10-24T10:00:00.000Z'))
  const { bus, events } = createRecordingEventBus()
  const state = createUpdateStateHolder({ eventBus: bus })
  const { repository, runs, versions } = inMemoryRepository()
  const { notifier, notified, resolved } = recordingNotifierCalls()
  let record: UpdateCheckRecord | undefined =
    latest === undefined ? undefined : { checkedAt: clock.now(), latest }
  const checkStore: UpdateCheckStore = {
    read: () => record,
    write: (next) => {
      record = next
    },
  }
  let exits = 0
  const processControl: ProcessControl = {
    enabled: true,
    appVersion,
    runtimeVersion: '0.2.0',
    exitForSwitch: () => {
      exits += 1
    },
  }
  const pendingWrites: string[] = []
  let report: SwitchReport | undefined
  const installer: ReleaseInstaller = {
    install: async ({ release: target }) => ok(manifest(target.version)),
    installed: async () => [],
    writePending: async (version) => {
      pendingWrites.push(version)
      return ok(undefined)
    },
    takeSwitchReport: async () => {
      const taken = report
      report = undefined
      return taken
    },
    ...installerOverrides,
  }
  const deps = {
    installer,
    repository,
    checkStore,
    notifier,
    state,
    processControl,
    clock,
    ids: createSequentialIds('run-'),
    logger: silentLogger,
  }
  return {
    ...deps,
    events,
    runs,
    versions,
    notified,
    resolved,
    pendingWrites,
    exits: () => exits,
    setReport: (next: SwitchReport) => {
      report = next
    },
    record: () => record,
  }
}
