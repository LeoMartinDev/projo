import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('deletes the source and its logo files', async () => {
  const world = createTvWorld()
  const { id } = world.addTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  })
  world.provider.answer({
    channels: [{ key: '1', name: 'One', group: '', upstream: { url: 'http://a/1.ts' } }],
  })
  await world.refreshTvSource({ sourceId: id })
  const [channel] = world.channels.channels.values()
  if (channel === undefined) throw new Error('not created')
  world.channels.repository.recordLogo({
    id: channel.id,
    url: 'http://a/1.png',
    at: new Date(),
    path: 'tv/one.png',
  })
  world.logos.files.set('tv/one.png', new Uint8Array([1]))

  expect(await world.deleteTvSource({ id })).toEqual({ ok: true, value: undefined })
  expect(world.sources.rows.size).toBe(0)
  expect(world.logos.files.size).toBe(0)
  expect(await world.deleteTvSource({ id })).toMatchObject({
    ok: false,
    error: { code: 'tv/source_not_found' },
  })
})
