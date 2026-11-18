import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('queues a refresh of a known source', () => {
  const world = createTvWorld()
  const { id } = world.addTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  })
  expect(world.requestTvSourceRefresh({ id })).toEqual({ ok: true, value: { jobId: 'job-1' } })
  expect(world.requestTvSourceRefresh({ id: 'nope' })).toMatchObject({
    ok: false,
    error: { code: 'tv/source_not_found' },
  })
})
