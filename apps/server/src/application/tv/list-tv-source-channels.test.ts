import { beforeEach, expect, test } from 'bun:test'

import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

let world: TvWorld
let sourceId: string
beforeEach(async () => {
  world = createTvWorld()
  sourceId = world.createTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  }).id
  world.provider.answer({
    channels: ['Télé Une', 'Deux', 'Trois TÉLÉ', 'Quatre', 'Cinq'].map((name, index) => ({
      key: name,
      name,
      group: index % 2 === 0 ? 'Even' : 'Odd',
      upstream: { url: `http://a/${index}.ts` },
    })),
  })
  await world.refreshTvSource({ sourceId })
})

const names = (result: ReturnType<TvWorld['listTvSourceChannels']>) =>
  result.ok ? result.value.items.map((channel) => channel.name) : result.error.code

test('pages the channels in playlist order', () => {
  const first = world.listTvSourceChannels({ sourceId, limit: 2 })
  expect(first).toMatchObject({ ok: true, value: { total: 5, nextCursor: '2' } })
  expect(names(first)).toEqual(['Télé Une', 'Deux'])
  const last = world.listTvSourceChannels({ sourceId, cursor: '4', limit: 2 })
  expect(names(last)).toEqual(['Cinq'])
  expect(last.ok && last.value.nextCursor).toBeUndefined()
})

test('searches names ignoring case and accents, within a group if asked', () => {
  expect(names(world.listTvSourceChannels({ sourceId, q: ' tele ', limit: 10 }))).toEqual([
    'Télé Une',
    'Trois TÉLÉ',
  ])
  const odd = world.channels.repository.groupsOf(sourceId).find((g) => g.name === 'Odd')?.id ?? ''
  expect(names(world.listTvSourceChannels({ sourceId, groupId: odd, limit: 10 }))).toEqual([
    'Deux',
    'Quatre',
  ])
  expect(names(world.listTvSourceChannels({ sourceId: 'nope', limit: 10 }))).toBe(
    'tv/source_not_found',
  )
})
