import { expect, test } from 'bun:test'

import { desktopUpdates } from './updates.ts'
import type { TauriInternals } from './tauri.ts'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const fakeInternals = (status: unknown) => {
  const calls: string[] = []
  const callbacks: ((message: unknown) => void)[] = []
  const internals: TauriInternals = {
    invoke: async (command) => {
      calls.push(command)
      if (command === 'desktop_update_status') return status
      if (command === 'plugin:event|listen') return 1
      return undefined
    },
    transformCallback: (callback) => callbacks.push(callback) - 1,
  }
  return { internals, calls, emit: (payload: unknown) => callbacks[0]?.({ payload }) }
}

test('offers a restart once a version is ready, from the status or the event', async () => {
  const fake = fakeInternals({})
  const updates = desktopUpdates(fake.internals)
  let notified = 0
  updates.subscribe(() => {
    notified += 1
  })
  updates.start({ onReconnect: () => () => undefined, isPlaying: () => false })
  await settle()
  expect(updates.offered()).toBeUndefined()
  fake.emit({ version: '0.5.0' })
  expect(updates.offered()).toBe('restart')
  expect(notified).toBe(1)

  const ready = desktopUpdates(fakeInternals({ ready: '0.5.0' }).internals)
  ready.start({ onReconnect: () => () => undefined, isPlaying: () => false })
  await settle()
  expect(ready.offered()).toBe('restart')
})

test('installs on apply', async () => {
  const fake = fakeInternals({ ready: '0.5.0' })
  await desktopUpdates(fake.internals).apply()
  expect(fake.calls).toContain('desktop_update_install')
})
