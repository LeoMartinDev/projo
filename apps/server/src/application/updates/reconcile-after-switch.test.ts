import { describe, expect, test } from 'bun:test'

import {
  manifest,
  createUpdateUseCasesWorld as setup,
} from '../../../test/support/update-use-cases-world.ts'
import { reconcileAfterSwitchFactory } from './reconcile-after-switch.ts'

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
