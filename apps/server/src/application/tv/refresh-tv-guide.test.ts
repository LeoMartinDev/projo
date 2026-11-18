import { beforeEach, describe, expect, test } from 'bun:test'

import type { TvGuideProgramme } from '../../core/tv/guide.ts'
import { createTvWorld, type TvWorld } from '../../../test/support/tv-world.ts'

const minutes = (world: TvWorld, value: number) =>
  new Date(world.clock.now().getTime() + value * 60_000)

const programme = (
  channel: string,
  start: Date,
  stop: Date | undefined,
  title: string,
  lang?: string,
): TvGuideProgramme => ({
  channel,
  start,
  ...(stop === undefined ? {} : { stop }),
  titles: [{ text: title, ...(lang === undefined ? {} : { lang }) }],
  subtitles: [],
  descriptions: [],
  categories: [],
})

let world: TvWorld
let sourceId: string
const channelId = (name: string) =>
  [...world.channels.channels.values()].find((channel) => channel.name === name)?.id ?? ''
const titles = () =>
  world.guide
    .programmes()
    .map(
      (p) =>
        `${[...world.channels.channels.values()].find((c) => c.id === p.channelId)?.name}: ${p.title}`,
    )
    .sort()

beforeEach(async () => {
  world = createTvWorld()
  sourceId = world.addTvSource({
    name: 'Provider',
    settings: { kind: 'm3u', playlistUrl: 'http://p/list.m3u', guideUrl: 'http://p/guide.xml' },
  }).id
  world.provider.answer({
    channels: [
      {
        key: 'a',
        name: 'News HD',
        group: 'News',
        upstream: { url: 'http://p/a' },
        guideKey: 'news',
      },
      {
        key: 'b',
        name: 'News FHD',
        group: 'News',
        upstream: { url: 'http://p/b' },
        guideKey: 'news',
      },
      { key: 'c', name: 'Télé Locale', group: 'News', upstream: { url: 'http://p/c' } },
      { key: 'd', name: 'Kids', group: 'Kids', upstream: { url: 'http://p/d' }, guideKey: 'kids' },
    ],
  })
  await world.refreshTvSource({ sourceId })
  const news = world.channels.repository.groupsOf(sourceId).find((g) => g.name === 'News')
  world.setTvGroupEnabled({ sourceId, groupId: news?.id ?? '', enabled: true })
  world.enqueued.length = 0
})

describe('refreshTvGuide (§29.3)', () => {
  test("keeps the window's programmes of the enabled channels, in the server's language", async () => {
    world.setGuideLanguage('en-US')
    world.provider.guide({
      channels: [{ id: 'local.tv', names: ['TELE locale'] }],
      programmes: [
        {
          ...programme('NEWS', minutes(world, -30), minutes(world, 30), 'Le journal', 'fr'),
          titles: [
            { lang: 'fr', text: 'Le journal' },
            { lang: 'en', text: 'The news' },
          ],
        },
        programme('news', minutes(world, -7 * 60), minutes(world, -6.5 * 60), 'Ended'),
        programme('news', minutes(world, 30), undefined, 'Open'),
        programme('news', minutes(world, 90), minutes(world, 120), 'Later'),
        programme('news', minutes(world, 73 * 60), minutes(world, 74 * 60), 'Too far'),
        programme('local.tv', minutes(world, -5), minutes(world, 55), 'Local'),
        programme('kids', minutes(world, -5), minutes(world, 55), 'Disabled channel'),
        programme('absent', minutes(world, -5), minutes(world, 55), 'Absent'),
      ],
    })
    expect(await world.refreshTvGuide({ sourceId })).toEqual({
      ok: true,
      value: { channels: 3, programmes: 7, available: true, matched: 3 },
    })
    expect(world.provider.guideReads).toEqual(['http://p/guide.xml'])
    expect(titles()).toEqual([
      'News FHD: Later',
      'News FHD: Open',
      'News FHD: The news',
      'News HD: Later',
      'News HD: Open',
      'News HD: The news',
      'Télé Locale: Local',
    ])
    const open = world.guide.programmes().find((p) => p.title === 'Open')
    expect(open?.endAt).toEqual(minutes(world, 90))
    expect(world.sources.rows.get(sourceId)?.guideAttemptAt).toEqual(world.clock.now())
  })

  test('a failed read changes nothing; a source without guide keeps none', async () => {
    world.provider.guide({
      programmes: [programme('news', minutes(world, -5), minutes(world, 55), 'Kept')],
    })
    await world.refreshTvGuide({ sourceId })
    world.provider.failGuide('tv/guide_invalid')
    expect(await world.refreshTvGuide({ sourceId })).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid' },
    })
    expect(titles()).toEqual(['News FHD: Kept', 'News HD: Kept'])
    world.provider.guide(undefined)
    expect(await world.refreshTvGuide({ sourceId })).toEqual({
      ok: true,
      value: { channels: 0, programmes: 0, available: false, matched: 0 },
    })
    expect(world.guide.programmes()).toEqual([])
  })

  test('a source without an enabled channel is not read; a deleted one is skipped', async () => {
    world.provider.guide({
      programmes: [programme('news', minutes(world, -5), minutes(world, 55), 'Kept')],
    })
    await world.refreshTvGuide({ sourceId })
    const news = world.channels.repository.groupsOf(sourceId).find((g) => g.name === 'News')
    world.setTvGroupEnabled({ sourceId, groupId: news?.id ?? '', enabled: false })
    world.provider.guideReads.length = 0
    expect(await world.refreshTvGuide({ sourceId })).toMatchObject({ ok: true })
    expect(world.provider.guideReads).toEqual([])
    expect(world.guide.programmes()).toEqual([])
    expect(await world.refreshTvGuide({ sourceId: 'gone' })).toEqual({ ok: true, value: undefined })
  })

  test('records what matched, stores the guide channels, kinds, and queues the images', async () => {
    world.provider.guide({
      channels: [
        { id: 'News@SD', names: ['Infos'] },
        { id: 'local.tv', names: ['Télé locale HD', 'TL'] },
      ],
      programmes: [
        {
          ...programme('news@sd', minutes(world, -5), minutes(world, 55), 'Le 13h'),
          categories: [{ lang: 'fr', text: 'Information' }],
          images: ['ftp://p/x.jpg', 'https://img.example/13h.jpg'],
          episode: { season: 2, episode: 5 },
        },
        programme('local.tv', minutes(world, -5), minutes(world, 55), 'Local'),
      ],
    })
    await world.refreshTvGuide({ sourceId })
    const byName = (name: string) => world.channels.channels.get(channelId(name))
    // `news` takes `News@SD` without its suffix; the local channel its normalised name.
    expect(byName('News HD')?.guideMatched).toBe('News@SD')
    expect(byName('Télé Locale')?.guideMatched).toBe('local.tv')
    expect(world.guideChannels.bySource.get(sourceId)).toEqual([
      { id: 'News@SD', names: ['Infos'] },
      { id: 'local.tv', names: ['Télé locale HD', 'TL'] },
    ])
    const news = world.guide.programmes().find((p) => p.title === 'Le 13h')
    expect(news).toMatchObject({
      kind: 'news',
      imageUrl: 'https://img.example/13h.jpg',
      episode: { season: 2, episode: 5 },
    })
    // Without a category, the channel's kind: its group "News".
    expect(world.guide.programmes().find((p) => p.title === 'Local')?.kind).toBe('news')
    expect(world.enqueued.map((job) => job.type)).toContain('fetch_tv_programme_images')
  })

  test("the admin's guide channel wins over matching and survives a source refresh", async () => {
    world.provider.guide({
      channels: [
        { id: 'news', names: ['News'] },
        { id: 'other', names: ['Other'] },
      ],
      programmes: [
        programme('news', minutes(world, -5), minutes(world, 55), 'Matched'),
        programme('other', minutes(world, -5), minutes(world, 55), 'Chosen'),
      ],
    })
    const hd = channelId('News HD')
    expect(world.setTvChannelGuideChannel({ id: hd, guideChannel: 'other' })).toMatchObject({
      ok: true,
      value: { guideChannel: 'other' },
    })
    expect(world.enqueued.map((job) => job.type)).toEqual(['refresh_tv_guide'])
    await world.refreshTvSource({ sourceId })
    expect(world.channels.channels.get(hd)?.guideChannel).toBe('other')
    await world.refreshTvGuide({ sourceId })
    expect(titles()).toContain('News HD: Chosen')
    expect(titles()).toContain('News FHD: Matched')
    expect(titles()).not.toContain('News HD: Matched')
    const page = world.listTvSourceChannels({ sourceId, limit: 50 })
    expect(page.ok && page.value.guideChannels.get('other')?.names).toEqual(['Other'])
    // "Automatic" clears it.
    world.setTvChannelGuideChannel({ id: hd, guideChannel: '' })
    expect(world.channels.channels.get(hd)?.guideChannel).toBeUndefined()
    await world.refreshTvGuide({ sourceId })
    expect(titles()).toContain('News HD: Matched')
  })

  test('programmes ended 6 hours ago are purged; the hourly task queues guides 6 hours old', async () => {
    world.provider.guide({
      programmes: [programme('news', minutes(world, -5), minutes(world, 55), 'Soon over')],
    })
    await world.refreshTvGuide({ sourceId })
    const other = world.addTvSource({
      name: 'Never read',
      settings: { kind: 'm3u', playlistUrl: 'http://q/list.m3u' },
    }).id
    world.enqueued.length = 0
    expect(world.queueDueTvGuideRefreshes()).toBe(1)
    expect(world.enqueued.map((job) => [job.type, job.payload])).toEqual([
      ['refresh_tv_guide', { sourceId: other }],
    ])
    world.clock.advance(7 * 60 * 60_000)
    world.enqueued.length = 0
    expect(world.queueDueTvGuideRefreshes()).toBe(2)
    expect(world.purgeEndedTvProgrammes()).toBe(2)
    expect(world.guide.programmes()).toEqual([])
    expect(channelId('News HD')).not.toBe('')
  })
})
