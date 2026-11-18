import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('gives a source with its groups in playlist order', async () => {
  const world = createTvWorld()
  const { id } = world.createTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  })
  world.provider.answer({
    channels: [
      { key: '1', name: 'One', group: 'Kids', upstream: { url: 'http://a/1.ts' } },
      { key: '2', name: 'Two', group: 'News', upstream: { url: 'http://a/2.ts' } },
    ],
  })
  await world.refreshTvSource({ sourceId: id })
  const result = world.getTvSource({ id })
  expect(result.ok && result.value.groups.map((group) => group.name)).toEqual(['Kids', 'News'])
  expect(world.getTvSource({ id: 'nope' })).toMatchObject({
    ok: false,
    error: { code: 'tv/source_not_found' },
  })
})
