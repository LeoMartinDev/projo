import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('creates the source and queues its first refresh', () => {
  const world = createTvWorld()
  const created = world.createTvSource({
    name: 'Provider',
    settings: { kind: 'm3u', playlistUrl: 'http://p/list.m3u' },
  })
  expect(created).toMatchObject({
    name: 'Provider',
    state: 'refreshing',
    channelCount: 0,
    failureCount: 0,
  })
  expect(created.maxConnections).toBeUndefined()
  expect(world.enqueued).toEqual([
    {
      type: 'refresh_tv_source',
      payload: { sourceId: created.id },
      dedupeKey: `tv_source:${created.id}`,
    },
  ])
})
