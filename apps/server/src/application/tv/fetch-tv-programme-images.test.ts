import { beforeEach, expect, test } from 'bun:test'

import type { TvGuideProgramme } from '../../core/tv/guide.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'
import { fetchTvProgrammeImagesFactory } from './fetch-tv-programme-images.ts'

const hour = 60 * 60_000
const jpg = { bytes: Uint8Array.from([0xff, 0xd8, 0xff]), type: 'jpg' as const }

let world: TvWorld
let sourceId: string
const minutes = (value: number) => new Date(world.clock.now().getTime() + value * 60_000)
const programme = (
  channel: string,
  from: number,
  to: number,
  title: string,
  image?: string,
): TvGuideProgramme => ({
  channel,
  start: minutes(from),
  stop: minutes(to),
  titles: [{ text: title }],
  subtitles: [],
  descriptions: [],
  categories: [],
  ...(image === undefined ? {} : { images: [image] }),
})
const fetchImages = async () => {
  const result = await world.fetchTvProgrammeImages()
  if (!result.ok) throw new Error(result.error.code)
  return result.value
}

beforeEach(async () => {
  world = createTvWorld()
  sourceId = world.addTvSource({
    name: 'A',
    settings: { kind: 'm3u', playlistUrl: 'http://a/list.m3u', userAgent: 'Box/1' },
  }).id
  world.provider.answer({
    channels: ['one', 'two', 'off'].map((key) => ({
      key,
      name: key,
      group: '',
      upstream: { url: `http://a/${key}.ts` },
      guideKey: key,
    })),
  })
  await world.refreshTvSource({ sourceId })
  for (const channel of world.channels.channels.values())
    if (channel.name !== 'off') world.setTvChannelEnabled({ id: channel.id, enabled: true })
  world.provider.guide({
    programmes: [
      programme('one', -10, 20, 'Now', 'https://img.test/shared.jpg'),
      programme('one', 20, 50, 'Next', 'https://img.test/next.jpg'),
      programme('one', 50, 80, 'Later', 'https://img.test/later.jpg'),
      programme('two', -10, 20, 'Same film', 'https://img.test/shared.jpg'),
      programme('two', 20, 50, 'Broken', 'https://img.test/missing.jpg'),
      programme('off', -10, 20, 'Disabled', 'https://img.test/off.jpg'),
    ],
  })
  await world.refreshTvGuide({ sourceId })
  world.logos.images.set('https://img.test/shared.jpg', jpg)
  world.logos.images.set('https://img.test/next.jpg', jpg)
})

test('now and next of enabled channels only, once per URL, with the source User-Agent', async () => {
  expect(await fetchImages()).toEqual({ fetched: 2, failed: 1 })
  expect(world.logos.downloads.map((download) => download.url).sort()).toEqual([
    'https://img.test/missing.jpg',
    'https://img.test/next.jpg',
    'https://img.test/shared.jpg',
  ])
  expect(world.logos.downloads.every((download) => download.userAgent === 'Box/1')).toBe(true)
  expect(
    [...world.logos.files.keys()].every((path) => /^tv\/programmes\/.+\.jpg$/u.test(path)),
  ).toBe(true)
})

test('a failure is tried again after 6 hours, an image fetched again after 7 days', async () => {
  await fetchImages()
  world.logos.downloads.length = 0
  expect(await fetchImages()).toEqual({ fetched: 0, failed: 0 })
  world.clock.advance(6 * hour + 1)
  // The guide moved on: what is on now and next then.
  world.provider.guide({
    programmes: [
      programme('one', -10, 20, 'Now', 'https://img.test/shared.jpg'),
      programme('two', -10, 20, 'Broken', 'https://img.test/missing.jpg'),
    ],
  })
  await world.refreshTvGuide({ sourceId })
  expect(await fetchImages()).toEqual({ fetched: 0, failed: 1 })
  expect(world.logos.downloads.map((download) => download.url)).toEqual([
    'https://img.test/missing.jpg',
  ])
  world.clock.advance(7 * 24 * hour)
  world.provider.guide({
    programmes: [programme('one', -10, 20, 'Now', 'https://img.test/shared.jpg')],
  })
  await world.refreshTvGuide({ sourceId })
  world.logos.downloads.length = 0
  expect(await fetchImages()).toEqual({ fetched: 1, failed: 0 })
})

test('failures are logged with the host and a fixed reason, never the URL', async () => {
  const { logger, lines } = createCapturingLogger()
  const fetchWithLogs = fetchTvProgrammeImagesFactory({
    tvSources: world.sources.repository,
    images: world.programmeImages.repository,
    downloader: {
      download: async () => ({
        ok: false,
        error: {
          code: 'tv/logo_unavailable',
          message: 'the channel logo could not be downloaded',
          context: { host: 'img.test', reason: 'http_404' },
        },
      }),
    },
    files: world.logos.logoFiles,
    clock: world.clock,
    logger,
  })
  await fetchWithLogs()
  const logged = JSON.stringify(lines)
  expect(logged).toContain('img.test')
  expect(logged).toContain('http_404')
  expect(logged).not.toContain('https://img.test')
})

test('stopped by its signal, it fails job/cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  expect(await world.fetchTvProgrammeImages({ signal: controller.signal })).toMatchObject({
    ok: false,
    error: { code: 'job/cancelled' },
  })
})

test('images no stored programme refers to are deleted, row and file', async () => {
  await fetchImages()
  expect(world.logos.files.size).toBe(2)
  world.provider.guide({ programmes: [programme('one', -10, 20, 'Plain')] })
  await world.refreshTvGuide({ sourceId })
  expect(await world.purgeTvProgrammeImages()).toBe(2)
  expect(world.logos.files.size).toBe(0)
  expect(world.programmeImages.rows.size).toBe(0)
})
