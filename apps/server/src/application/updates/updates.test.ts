import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { createManualClock } from '../../../test/support/clock.ts'
import { createRecordingEventBus, createSequentialIds } from '../../../test/support/fakes.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { AdminNotifier } from '../../core/scanner/ports.ts'
import type {
  AppVersion,
  ProcessControl,
  Release,
  ReleaseInstaller,
  ReleaseManifest,
  ReleaseSource,
  SwitchReport,
  UpdateCheckRecord,
  UpdateCheckStore,
  UpdateRepository,
  UpdateRun,
} from '../../core/updates/update.ts'
import { applyUpdateFactory } from './apply-update.ts'
import { checkUpdatesFactory } from './check-updates.ts'
import { reconcileAfterSwitchFactory } from './reconcile.ts'
import { createUpdateStateHolder } from './state.ts'

const release = (version: string, runtimeMin = '0.1.0'): Release => ({
  version,
  tag: `v${version}`,
  publishedAt: new Date('2026-10-24T09:00:00.000Z'),
  notes: '',
  url: `https://github.com/LeoMartinDev/projo/releases/tag/v${version}`,
  archive: { name: `projo-app-${version}.tar.gz`, url: 'https://github.com/a', sizeBytes: 1 },
  checksums: { name: 'SHA256SUMS', url: 'https://github.com/b', sizeBytes: 1 },
  runtimeMin,
})

const manifest = (version: string): ReleaseManifest => ({
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

const recordingNotifier = () => {
  const notified: { kind: string; key: string }[] = []
  const resolved: { kind: string; key: string }[] = []
  const notifier: AdminNotifier = {
    notify: ({ kind, key }) => void notified.push({ kind, key }),
    resolve: ({ kind, key }) => void resolved.push({ kind, key }),
  }
  return { notifier, notified, resolved }
}

const setup = ({
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
  const { notifier, notified, resolved } = recordingNotifier()
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

describe('check_updates', () => {
  test('GitHub down: the error is recorded, the release found before is kept', async () => {
    const world = setup({ latest: release('1.4.0') })
    const releaseSource: ReleaseSource = {
      latest: async () => err(appError('update/check_failed', 'GitHub is unreachable')),
    }
    const check = checkUpdatesFactory({ ...world, releaseSource })
    expect((await check()).ok).toBe(true)
    expect(world.record()).toMatchObject({
      latest: { version: '1.4.0' },
      error: { code: 'update/check_failed' },
    })
    expect(world.state.current().state).toBe('failed')
  })

  test('a newer release supersedes the one notified before', async () => {
    const world = setup({ latest: release('1.4.0') })
    const releaseSource: ReleaseSource = { latest: async () => ok(release('1.5.0')) }
    await checkUpdatesFactory({ ...world, releaseSource })()
    expect(world.resolved).toContainEqual({ kind: 'update/available', key: '1.4.0' })
    expect(world.notified).toEqual([{ kind: 'update/available', key: '1.5.0' }])
    expect(world.events.at(-1)).toEqual({
      type: 'update.state',
      payload: { state: 'available', version: '1.5.0' },
    })
  })

  test('a check during a download leaves the live state alone', async () => {
    const world = setup({ latest: release('1.4.0') })
    world.state.set({ state: 'downloading', version: '1.4.0', progress: 40 })
    const releaseSource: ReleaseSource = { latest: async () => ok(release('1.4.0')) }
    await checkUpdatesFactory({ ...world, releaseSource })()
    expect(world.state.current()).toEqual({ state: 'downloading', version: '1.4.0', progress: 40 })
    expect(world.record()?.latest?.version).toBe('1.4.0')
  })
})

describe('apply_update', () => {
  test('installed, pending written, then the exit for the switch', async () => {
    const world = setup({ latest: release('1.4.0') })
    const apply = applyUpdateFactory(world)
    const result = await apply({
      version: '1.4.0',
      signal: new AbortController().signal,
      reportProgress: () => {},
    })
    expect(result.ok).toBe(true)
    expect(world.pendingWrites).toEqual(['1.4.0'])
    expect(world.exits()).toBe(1)
    expect(world.versions.get('1.4.0')?.state).toBe('staged')
    expect(world.runs).toMatchObject([{ toVersion: '1.4.0', outcome: 'pending' }])
    expect(
      world.events.flatMap((event) => (event.type === 'update.state' ? [event.payload.state] : [])),
    ).toEqual(['downloading', 'applying', 'restarting'])
  })

  test('interrupted by a stop: the run fails without notifying', async () => {
    const controller = new AbortController()
    const world = setup({
      latest: release('1.4.0'),
      installer: {
        install: async () => {
          controller.abort()
          return err(appError('update/download_failed', 'aborted'))
        },
      },
    })
    const result = await applyUpdateFactory(world)({
      version: '1.4.0',
      signal: controller.signal,
      reportProgress: () => {},
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'update/download_failed' } })
    expect(world.runs).toMatchObject([{ outcome: 'failed' }])
    expect(world.notified).toEqual([])
    expect(world.exits()).toBe(0)
  })
})

describe('reconcile after a switch', () => {
  test('a pending run without report: the switch never happened', async () => {
    const world = setup({
      installer: { installed: async () => [{ version: '1.3.0', manifest: manifest('1.3.0') }] },
    })
    world.repository.startRun({
      id: 'run-0',
      kind: 'update',
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      requestedAt: new Date('2026-10-24T09:00:00.000Z'),
    })
    await reconcileAfterSwitchFactory(world)()
    expect(world.runs).toMatchObject([
      { id: 'run-0', outcome: 'failed', error: { code: 'update/install_failed' } },
    ])
    expect(world.versions.get('1.3.0')?.state).toBe('current')
  })

  test('the report closes the run; versions follow the disk', async () => {
    const world = setup({
      appVersion: '1.4.0',
      installer: {
        installed: async () => [
          { version: '1.4.0', manifest: manifest('1.4.0') },
          { version: '1.3.0', manifest: manifest('1.3.0') },
        ],
      },
    })
    world.versions.set('1.3.0', {
      version: '1.3.0',
      state: 'current',
      installedAt: new Date('2026-10-01T00:00:00.000Z'),
      runtimeMin: '0.1.0',
    })
    world.repository.startRun({
      id: 'run-0',
      kind: 'update',
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      requestedAt: new Date('2026-10-24T09:00:00.000Z'),
    })
    world.setReport({
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      outcome: 'switched',
      at: new Date('2026-10-24T09:01:00.000Z'),
    })
    await reconcileAfterSwitchFactory(world)()
    expect(world.runs).toMatchObject([{ outcome: 'succeeded' }])
    expect(world.versions.get('1.4.0')?.state).toBe('current')
    expect(world.versions.get('1.3.0')?.state).toBe('previous')
    expect(world.resolved).toContainEqual({ kind: 'update/available', key: '1.4.0' })
  })
})

describe('update state', () => {
  test('identical states are published once', () => {
    const { bus, events } = createRecordingEventBus()
    const state = createUpdateStateHolder({ eventBus: bus })
    state.set({ state: 'downloading', version: '1.4.0', progress: 10.2 })
    state.set({ state: 'downloading', version: '1.4.0', progress: 10.4 })
    state.set({ state: 'downloading', version: '1.4.0', progress: 11 })
    expect(events.map((event) => event.payload)).toEqual([
      { state: 'downloading', version: '1.4.0', progress: 10 },
      { state: 'downloading', version: '1.4.0', progress: 11 },
    ])
  })
})
