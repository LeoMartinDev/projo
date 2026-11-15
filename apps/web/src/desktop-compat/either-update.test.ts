import { expect, test } from 'bun:test'

import type { HostUpdates, UpdateOffer } from '@projo/web-app/host'

import { eitherUpdate } from './either-update.ts'

const source = (offer: UpdateOffer | undefined) => {
  const applied: string[] = []
  const updates: HostUpdates = {
    start: () => () => undefined,
    offered: () => offer,
    subscribe: () => () => undefined,
    apply: async () => {
      applied.push(offer ?? 'none')
    },
  }
  return { updates, applied }
}

test("offers the server's new web app before the desktop app's update", async () => {
  const web = source('reload')
  const desktop = source('restart')
  const both = eitherUpdate(web.updates, desktop.updates)
  expect(both.offered()).toBe('reload')
  await both.apply()
  expect(web.applied).toEqual(['reload'])
  expect(desktop.applied).toEqual([])
})

test("falls back to the desktop app's update", async () => {
  const desktop = source('restart')
  const both = eitherUpdate(source(undefined).updates, desktop.updates)
  expect(both.offered()).toBe('restart')
  await both.apply()
  expect(desktop.applied).toEqual(['restart'])
})
