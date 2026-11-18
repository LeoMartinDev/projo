import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('creates the source and queues its first refresh', () => {
  const world = createTvWorld()
  const result = world.createTvSource({
    name: 'Provider',
    settings: { kind: 'm3u', playlistUrl: 'http://p/list.m3u' },
  })
  if (!result.ok) throw new Error(result.error.message)
  const created = result.value
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

test("an Xtream source's limit is its account's: the admin cannot set it (§29.2)", () => {
  const world = createTvWorld()
  const settings = {
    kind: 'xtream' as const,
    serverUrl: 'http://panel.test',
    username: 'jo',
    password: 'pw',
  }
  expect(world.createTvSource({ name: 'Panel', settings, maxConnections: 2 })).toMatchObject({
    ok: false,
    error: { code: 'tv/source_invalid', context: { kind: 'xtream' } },
  })
  expect(world.sources.rows.size).toBe(0)
  expect(world.enqueued).toEqual([])
  expect(world.createTvSource({ name: 'Panel', settings })).toMatchObject({ ok: true })
})
