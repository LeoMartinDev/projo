import { expect, test } from 'bun:test'

import { createTvWorld } from '../../../test/support/tv-world.ts'

test('serves the logo of an enabled channel, of a disabled one to an admin only', async () => {
  const world = createTvWorld()
  const { id: sourceId } = world.createTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u' },
  })
  world.provider.answer({
    channels: [
      { key: '1', name: 'One', group: '', upstream: { url: 'http://a/1.ts' } },
      { key: '2', name: 'Two', group: '', upstream: { url: 'http://a/2.ts' } },
    ],
  })
  await world.refreshTvSource({ sourceId })
  const [one, two] = world.channels.repository.listChannels({ sourceId, offset: 0, limit: 2 }).items
  if (one === undefined || two === undefined) throw new Error('not created')
  world.channels.repository.recordLogo({
    id: one.id,
    url: 'http://l/1.jpg',
    at: new Date(),
    path: `tv/${one.id}.jpg`,
  })

  const logo = (channelId: string, admin: boolean) => world.getTvChannelLogo({ channelId, admin })
  expect(logo(one.id, true)).toEqual({
    ok: true,
    value: { path: `/images/tv/${one.id}.jpg`, contentType: 'image/jpeg' },
  })
  expect(logo(one.id, false)).toMatchObject({ ok: false, error: { code: 'tv/channel_not_found' } })
  world.setTvChannelEnabled({ id: one.id, enabled: true })
  expect(logo(one.id, false).ok).toBe(true)
  expect(logo(two.id, true).ok).toBe(false)
})
