import { beforeEach, expect, test } from 'bun:test'

import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

let world: TvWorld
let sourceId: string
const groupId = (name: string) => {
  const group = world.channels.repository.groupsOf(sourceId).find((g) => g.name === name)
  if (group === undefined) throw new Error(`no group ${name}`)
  return group.id
}

beforeEach(async () => {
  world = createTvWorld()
  sourceId = world.createTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  }).id
  world.provider.answer({
    channels: ['1', '2', '3'].map((n) => ({
      key: n,
      name: `Channel ${n}`,
      group: n === '3' ? 'Kids' : 'News',
      upstream: { url: `http://a/${n}.ts` },
    })),
  })
  await world.refreshTvSource({ sourceId })
  world.enqueued.length = 0
})

test('enabling a group enables its channels and queues their logos', () => {
  expect(world.setTvGroupEnabled({ sourceId, groupId: groupId('News'), enabled: true })).toEqual({
    ok: true,
    value: expect.objectContaining({
      name: 'News',
      enabled: true,
      channelCount: 2,
      enabledChannelCount: 2,
    }),
  })
  expect(world.enqueued.map((job) => job.type)).toEqual(['fetch_tv_logos'])
  expect(world.channels.repository.findGroup(groupId('Kids'))?.enabledChannelCount).toBe(0)
})

test('a channel switched on its own leaves its group flag; the group switch overrides it', () => {
  const news = groupId('News')
  const first = world.channels.repository.listChannels({
    sourceId,
    groupId: news,
    offset: 0,
    limit: 1,
  }).items[0]
  if (first === undefined) throw new Error('no channel')
  expect(world.setTvChannelEnabled({ id: first.id, enabled: true })).toMatchObject({
    ok: true,
    value: { id: first.id, enabled: true },
  })
  expect(world.channels.repository.findGroup(news)).toMatchObject({
    enabled: false,
    enabledChannelCount: 1,
  })
  world.setTvGroupEnabled({ sourceId, groupId: news, enabled: true })
  world.setTvGroupEnabled({ sourceId, groupId: news, enabled: false })
  expect(world.channels.repository.findChannel(first.id)?.enabled).toBe(false)
})

test('refuses a group of another source', () => {
  const other = world.createTvSource({
    name: 'B',
    settings: { kind: 'm3u', playlistUrl: 'http://b/list.m3u' },
  }).id
  expect(
    world.setTvGroupEnabled({ sourceId: other, groupId: groupId('News'), enabled: true }),
  ).toMatchObject({ ok: false, error: { code: 'tv/group_not_found' } })
  expect(
    world.setTvGroupEnabled({ sourceId: 'nope', groupId: groupId('News'), enabled: true }),
  ).toMatchObject({ ok: false, error: { code: 'tv/source_not_found' } })
})
