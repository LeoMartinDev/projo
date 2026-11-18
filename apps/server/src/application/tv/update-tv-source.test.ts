import { beforeEach, expect, test } from 'bun:test'

import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

let world: TvWorld
let id: string
beforeEach(() => {
  world = createTvWorld()
  id = world.createTvSource({
    name: 'Provider',
    settings: {
      kind: 'm3u',
      playlistUrl: 'http://p/get.php?password=secret',
      guideUrl: 'http://p/xmltv.php',
    },
    maxConnections: 2,
  }).id
  world.enqueued.length = 0
})

test('renames and changes the limit without a refresh', () => {
  const result = world.updateTvSource({ id, name: 'Renamed', maxConnections: 'none' })
  expect(result).toMatchObject({ ok: true, value: { name: 'Renamed', state: 'pending' } })
  expect(world.sources.rows.get(id)?.maxConnections).toBeUndefined()
  expect(world.enqueued).toEqual([])
})

test('a new User-Agent or playlist URL queues a refresh, the guide URL alone the guide', () => {
  world.updateTvSource({ id, settings: { kind: 'm3u', guideUrl: '' } })
  expect(world.sources.rows.get(id)?.settings).toEqual({
    kind: 'm3u',
    playlistUrl: 'http://p/get.php?password=secret',
  })
  expect(world.enqueued.map((job) => [job.type, job.dedupeKey])).toEqual([
    ['refresh_tv_guide', `tv_guide:${id}`],
  ])
  world.enqueued.length = 0
  world.updateTvSource({ id, settings: { kind: 'm3u', guideUrl: '' } })
  expect(world.enqueued).toEqual([])

  const result = world.updateTvSource({ id, settings: { kind: 'm3u', userAgent: 'Box/1' } })
  expect(result).toMatchObject({ ok: true, value: { state: 'refreshing' } })
  expect(world.enqueued.map((job) => job.type)).toEqual(['refresh_tv_source'])
  expect(world.sources.rows.get(id)).toMatchObject({ maxConnections: 2, failureCount: 0 })
})

test('keeps what the source recorded of its refreshes', async () => {
  world.provider.fail()
  await world.refreshTvSource({ sourceId: id })
  world.updateTvSource({ id, name: 'Renamed' })
  expect(world.sources.rows.get(id)).toMatchObject({ failureCount: 1, lastError: {} })
})

test('refuses an unknown source', () => {
  expect(world.updateTvSource({ id: 'nope', name: 'x' })).toMatchObject({
    ok: false,
    error: { code: 'tv/source_not_found' },
  })
})
