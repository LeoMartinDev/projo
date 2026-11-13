import { describe, expect, test } from 'bun:test'

import { appError, err, ok } from '@projo/shared'

import { manifest, release, setupUpdates as setup } from '../../../test/support/updates-fakes.ts'
import { applyUpdateFactory } from './apply-update.ts'

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

describe('apply_update retried or cancelled', () => {
  test('a retried old job for the running version installs nothing', async () => {
    const installs: string[] = []
    const world = setup({
      appVersion: '1.4.0',
      latest: release('1.4.0'),
      installer: {
        install: async ({ release: target }) => {
          installs.push(target.version)
          return ok(manifest(target.version))
        },
      },
    })
    const result = await applyUpdateFactory(world)({
      version: '1.4.0',
      signal: new AbortController().signal,
      reportProgress: () => {},
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'update/already_current' } })
    expect(installs).toEqual([])
    expect(world.exits()).toBe(0)
  })

  test('a cancel that arrives during the download stops before the switch', async () => {
    const controller = new AbortController()
    const world = setup({
      latest: release('1.4.0'),
      installer: {
        install: async ({ release: target }) => {
          controller.abort()
          return ok(manifest(target.version))
        },
      },
    })
    const result = await applyUpdateFactory(world)({
      version: '1.4.0',
      signal: controller.signal,
      reportProgress: () => {},
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'job/cancelled' } })
    expect(world.pendingWrites).toEqual([])
    expect(world.exits()).toBe(0)
    expect(world.runs).toMatchObject([{ outcome: 'failed' }])
  })
})
