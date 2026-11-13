import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import {
  release,
  createUpdateUseCasesWorld as setup,
} from '../../../test/support/update-use-cases-world.ts'
import type { ReleaseSource } from '../../core/updates/update.ts'
import { checkUpdatesFactory } from './check-updates.ts'

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
