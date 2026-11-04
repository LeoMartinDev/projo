import { expect, test } from 'bun:test'

import { createUpdater, updateAction } from './update-policy.ts'

test('reloads on its own only when nobody is looking or nothing is going on', () => {
  const at = (trigger: Parameters<typeof updateAction>[0]['trigger'], hidden = false) =>
    updateAction({ trigger, hidden, playing: false })
  expect(at('boot')).toBe('reload')
  expect(at('resume')).toBe('reload')
  expect(at('hide')).toBe('reload')
  expect(at('reconnect', true)).toBe('reload')
  expect(at('reconnect')).toBe('offer')
})

test('never reloads under a playing video', () => {
  for (const trigger of ['boot', 'resume', 'reconnect', 'hide'] as const)
    expect(updateAction({ trigger, hidden: true, playing: true })).toBe('offer')
})

const world = () => {
  let stored: string | undefined
  const calls: string[] = []
  const updater = createUpdater({
    activateLatest: async () => {
      calls.push('activate')
    },
    resetWorker: async () => {
      calls.push('reset')
    },
    reload: () => calls.push('reload'),
    attempts: {
      read: () => stored,
      write: (value) => {
        stored = value
      },
      clear: () => {
        stored = undefined
      },
    },
  })
  return { updater, calls }
}

test('activates the new worker then reloads', async () => {
  const { updater, calls } = world()
  expect(await updater.apply('1.8.0')).toBe('reloading')
  expect(calls).toEqual(['activate', 'reload'])
})

test('drops the worker when a reload did not bring the version, then gives up', async () => {
  const { updater, calls } = world()
  await updater.apply('1.8.0')
  await updater.apply('1.8.0')
  expect(await updater.apply('1.8.0')).toBe('gave_up')
  expect(calls).toEqual(['activate', 'reload', 'reset', 'reload'])
})

test('starts over once a check found the versions equal', async () => {
  const { updater, calls } = world()
  await updater.apply('1.8.0')
  updater.settled()
  await updater.apply('1.8.0')
  expect(calls).toEqual(['activate', 'reload', 'activate', 'reload'])
})
