import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

const hour = 60 * 60_000

test('queues the sources whose last attempt is a day old, and those never tried', async () => {
  const world = createTvWorld()
  const create = (name: string) =>
    world.addTvSource({ name, settings: { kind: 'm3u', playlistUrl: `http://${name}/l.m3u` } }).id
  const old = create('old')
  const recent = create('recent')
  const never = create('never')
  world.provider.fail()
  await world.refreshTvSource({ sourceId: old })
  world.clock.advance(2 * hour)
  await world.refreshTvSource({ sourceId: recent })
  world.clock.advance(22 * hour)
  world.enqueued.length = 0

  expect(world.queueDueTvSourceRefreshes()).toBe(2)
  expect(world.enqueued.map((job) => job.payload)).toEqual([{ sourceId: never }, { sourceId: old }])
})
