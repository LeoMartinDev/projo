import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('switches one channel and queues its logo when enabled; a missing one is not found', async () => {
  const world = createTvWorld()
  const { id: sourceId } = world.addTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  })
  const one = { key: '1', name: 'One', group: '', upstream: { url: 'http://a/1.ts' } }
  const two = { key: '2', name: 'Two', group: '', upstream: { url: 'http://a/2.ts' } }
  world.provider.answer({ channels: [one, two] })
  await world.refreshTvSource({ sourceId })
  const channelId = (name: string) =>
    [...world.channels.channels.values()].find((channel) => channel.name === name)?.id ?? ''
  world.enqueued.length = 0

  expect(world.setTvChannelEnabled({ id: channelId('One'), enabled: true })).toMatchObject({
    ok: true,
    value: { name: 'One', enabled: true },
  })
  expect(world.enqueued.map((job) => job.type)).toEqual(['fetch_tv_logos', 'refresh_tv_guide'])
  world.setTvChannelEnabled({ id: channelId('One'), enabled: false })
  expect(world.enqueued).toHaveLength(2)

  world.provider.answer({ channels: [one] })
  await world.refreshTvSource({ sourceId })
  expect(world.setTvChannelEnabled({ id: channelId('Two'), enabled: true })).toMatchObject({
    ok: false,
    error: { code: 'tv/channel_not_found' },
  })
})
