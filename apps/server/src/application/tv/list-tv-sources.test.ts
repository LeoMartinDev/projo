import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('lists the sources with their channel counts and state', async () => {
  const world = createTvWorld()
  const a = world.createTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  })
  const b = world.createTvSource({
    name: 'B',
    settings: { kind: 'm3u', playlistUrl: 'http://b/list.m3u' },
  })
  world.provider.answer({
    channels: [{ key: 'k', name: 'One', group: 'G', upstream: { url: 'http://a/1.ts' } }],
  })
  await world.refreshTvSource({ sourceId: a.id })
  world.refreshing.add(b.id)

  expect(
    world
      .listTvSources()
      .map(({ name, state, channelCount, enabledChannelCount }) => [
        name,
        state,
        channelCount,
        enabledChannelCount,
      ]),
  ).toEqual([
    ['A', 'ready', 1, 0],
    ['B', 'refreshing', 0, 0],
  ])
  world.refreshing.clear()
  expect(world.listTvSources()[1]?.state).toBe('pending')
})
