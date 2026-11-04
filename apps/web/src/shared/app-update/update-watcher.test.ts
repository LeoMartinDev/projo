import { expect, test } from 'bun:test'

import { createUpdateWatcher } from './update-watcher.ts'

const world = (init: { server?: string; hidden?: boolean; playing?: boolean } = {}) => {
  const state = {
    server: init.server,
    hidden: init.hidden ?? false,
    playing: init.playing ?? false,
  }
  const applied: string[] = []
  let settled = 0
  let outcome: 'reloading' | 'gave_up' = 'reloading'
  const watcher = createUpdateWatcher({
    readServerVersion: async () => state.server,
    webVersion: () => '1.7.0',
    updater: {
      apply: async (target) => {
        applied.push(target)
        return outcome
      },
      settled: () => {
        settled += 1
      },
    },
    isHidden: () => state.hidden,
    isPlaying: () => state.playing,
  })
  return {
    watcher,
    state,
    applied,
    settled: () => settled,
    giveUp: () => {
      outcome = 'gave_up'
    },
  }
}

test('does nothing while the server runs the same version, and clears the reload guard', async () => {
  const { watcher, applied, settled } = world({ server: '1.7.0' })
  await watcher.check('boot')
  expect(applied).toEqual([])
  expect(watcher.offered()).toBeUndefined()
  expect(settled()).toBe(1)
})

test('does nothing when the server cannot be reached', async () => {
  const { watcher, applied } = world()
  await watcher.check('reconnect')
  expect(applied).toEqual([])
  expect(watcher.offered()).toBeUndefined()
})

test('reloads straight away at launch', async () => {
  const { watcher, applied } = world({ server: '1.8.0' })
  await watcher.check('boot')
  expect(applied).toEqual(['1.8.0'])
})

test('reloads straight away when the app comes back', async () => {
  const { watcher, applied } = world({ server: '1.8.0' })
  await watcher.check('resume')
  expect(applied).toEqual(['1.8.0'])
})

test('applies one update at a time', async () => {
  const { watcher, applied } = world({ server: '1.8.0' })
  await Promise.all([watcher.check('boot'), watcher.check('resume'), watcher.check('boot')])
  expect(applied).toEqual(['1.8.0'])
})

test('offers the update to someone using the app, then applies it on demand or once hidden', async () => {
  const { watcher, applied } = world({ server: '1.8.0' })
  let notified = 0
  watcher.subscribe(() => {
    notified += 1
  })
  await watcher.check('reconnect')
  expect(applied).toEqual([])
  expect(watcher.offered()).toBe('1.8.0')
  expect(notified).toBe(1)

  await watcher.applyOffered()
  expect(applied).toEqual(['1.8.0'])
})

test('applies an offered update as soon as the app goes to the background', async () => {
  const { watcher, state, applied } = world({ server: '1.8.0' })
  await watcher.check('reconnect')
  state.hidden = true
  await watcher.hidden()
  expect(applied).toEqual(['1.8.0'])
})

test('keeps offering while a video plays, even in the background', async () => {
  const { watcher, applied } = world({ server: '1.8.0', hidden: true, playing: true })
  await watcher.check('resume')
  await watcher.hidden()
  expect(applied).toEqual([])
  expect(watcher.offered()).toBe('1.8.0')
})

test('withdraws the offer once reloading stopped helping', async () => {
  const { watcher, giveUp } = world({ server: '1.8.0' })
  await watcher.check('reconnect')
  giveUp()
  await watcher.applyOffered()
  expect(watcher.offered()).toBeUndefined()
})
