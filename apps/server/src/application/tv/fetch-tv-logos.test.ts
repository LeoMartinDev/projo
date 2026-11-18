import { beforeEach, expect, test } from 'bun:test'

import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

const hour = 60 * 60_000
const png = { bytes: Uint8Array.from([0x89, 0x50]), type: 'png' as const }

let world: TvWorld
let sourceId: string
const channel = (name: string) => {
  const found = [...world.channels.channels.values()].find((c) => c.name === name)
  if (found === undefined) throw new Error(`no channel ${name}`)
  return found
}
const fetchLogos = async (signal?: AbortSignal) => {
  const result = await world.fetchTvLogos({ sourceId, ...(signal === undefined ? {} : { signal }) })
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}
const listing = (logos: Record<string, string | undefined>) =>
  world.provider.answer({
    channels: Object.entries(logos).map(([name, logoUrl]) => ({
      key: name,
      name,
      group: '',
      upstream: { url: `http://a/${name}.ts`, ...(name === 'B' ? { userAgent: 'Own/1' } : {}) },
      ...(logoUrl === undefined ? {} : { logoUrl }),
    })),
  })

beforeEach(async () => {
  world = createTvWorld()
  sourceId = world.createTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u', userAgent: 'Box/1' },
  }).id
  listing({ A: 'http://l/a.png', B: 'http://l/b.png', C: 'http://l/c.png', D: undefined })
  await world.refreshTvSource({ sourceId })
  for (const name of ['A', 'B', 'D'])
    world.setTvChannelEnabled({ id: channel(name).id, enabled: true })
  world.logos.images.set('http://l/a.png', png)
})

test('downloads the logos of enabled channels only, with the channel or source User-Agent', async () => {
  expect(await fetchLogos()).toEqual({ fetched: 1, failed: 1, dropped: 0 })
  expect(world.logos.downloads).toEqual([
    { url: 'http://l/a.png', userAgent: 'Box/1' },
    { url: 'http://l/b.png', userAgent: 'Own/1' },
  ])
  expect(channel('A').logoPath).toBe(`tv/${channel('A').id}.png`)
  expect(world.logos.files.has(`tv/${channel('A').id}.png`)).toBe(true)
  expect(world.getTvChannelLogo({ channelId: channel('A').id, admin: false })).toMatchObject({
    ok: true,
    value: { contentType: 'image/png' },
  })
})

test('a failed logo is tried again after a day, a fetched one only when its URL changes', async () => {
  await fetchLogos()
  world.logos.downloads.length = 0
  expect(await fetchLogos()).toEqual({ fetched: 0, failed: 0, dropped: 0 })

  world.clock.advance(25 * hour)
  world.logos.images.set('http://l/b.png', png)
  expect(await fetchLogos()).toEqual({ fetched: 1, failed: 0, dropped: 0 })
  expect(world.logos.downloads.map((d) => d.url)).toEqual(['http://l/b.png'])

  listing({ A: 'http://l/a2.png', B: undefined, C: 'http://l/c.png', D: undefined })
  await world.refreshTvSource({ sourceId })
  world.logos.images.set('http://l/a2.png', png)
  world.logos.downloads.length = 0
  expect(await fetchLogos()).toEqual({ fetched: 1, failed: 0, dropped: 1 })
  expect(world.logos.downloads.map((d) => d.url)).toEqual(['http://l/a2.png'])
  expect(channel('B').logoPath).toBeUndefined()
  expect(world.logos.files.has(`tv/${channel('B').id}.png`)).toBe(false)
})

test('a changed logo URL that fails keeps the previous logo, tried again a day later', async () => {
  await fetchLogos()
  const before = channel('A').logoPath
  listing({ A: 'http://l/a2.png', B: 'http://l/b.png', C: 'http://l/c.png', D: undefined })
  await world.refreshTvSource({ sourceId })
  world.logos.downloads.length = 0
  expect(await fetchLogos()).toEqual({ fetched: 0, failed: 1, dropped: 0 })
  expect(world.logos.downloads.map((d) => d.url)).toEqual(['http://l/a2.png'])
  expect(channel('A').logoPath).toBe(before)
  expect(world.getTvChannelLogo({ channelId: channel('A').id, admin: false }).ok).toBe(true)

  world.logos.downloads.length = 0
  world.clock.advance(23 * hour)
  expect(await fetchLogos()).toEqual({ fetched: 0, failed: 0, dropped: 0 })
  world.clock.advance(2 * hour)
  world.logos.images.set('http://l/a2.png', { bytes: Uint8Array.from([0xff, 0xd8]), type: 'jpg' })
  expect(await fetchLogos()).toEqual({ fetched: 1, failed: 1, dropped: 0 })
  expect(channel('A')).toMatchObject({
    logoPath: `tv/${channel('A').id}.jpg`,
    logoFetchedUrl: 'http://l/a2.png',
  })
  expect(channel('A').logoFailedAt).toBeUndefined()
  expect([...world.logos.files.keys()]).toEqual([`tv/${channel('A').id}.jpg`])
})

test('a logo fetched for a channel deleted meanwhile leaves no file behind', async () => {
  world.logos.hooks.duringDownload = async () => {
    await world.deleteTvSource({ id: sourceId })
    world.channels.channels.clear() // SQLite deletes them with their source
  }
  expect(await fetchLogos()).toEqual({ fetched: 0, failed: 1, dropped: 0 })
  expect([...world.logos.files.keys()]).toEqual([])
})

test('stopped by the server, the job fails job/cancelled and records nothing', async () => {
  const controller = new AbortController()
  world.logos.hooks.duringDownload = async () => {
    controller.abort()
  }
  expect(await world.fetchTvLogos({ sourceId, signal: controller.signal })).toMatchObject({
    ok: false,
    error: { code: 'job/cancelled' },
  })
  expect(channel('A').logoFetchedUrl).toBeUndefined()
  expect(world.logos.files.size).toBe(0)
})
