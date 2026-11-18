import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'
import {
  adminTvChannelsPageSchema,
  adminTvGuideChannelsPageSchema,
  type AdminTvSourceDetailDto,
  adminTvSourceDetailDtoSchema,
  tvProgrammeDetailDtoSchema,
  type TvChannelsResponse,
  tvChannelsResponseSchema,
  tvGuideResponseSchema,
  tvScheduleResponseSchema,
} from '@projo/shared/api/tv'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { buildTvModule } from '../../src/entrypoints/modules/tv.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { DEFAULT_METADATA_LANGUAGE } from '../../src/infrastructure/sqlite/metadata-settings-repository.ts'
import { createTvLogoDownloader } from '../../src/infrastructure/tv/logo-downloader.ts'
import { createAuthTestApp, sessionCookieOf } from '../support/auth-app.ts'
import { createTempDir } from '../support/database.ts'
import { type IptvServer, startIptvServer } from '../support/iptv-server.ts'
import { silentLogger } from '../support/logger.ts'

const minute = 60_000

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
})
afterAll(() => iptv.stop())

let temp: ReturnType<typeof createTempDir>
let t: ReturnType<typeof createAuthTestApp>
let platform: Platform
let module: ReturnType<typeof buildTvModule>
let cookies: { admin: string; user: string }

beforeEach(async () => {
  temp = createTempDir()
  const paths = dataPathsFor(temp.path.replaceAll('\\', '/'))
  if (!ensureDataLayout(paths).ok) throw new Error('no data layout')
  t = createAuthTestApp({
    paths,
    jobs: 'queue',
    routes: (built) => {
      module = buildTvModule(
        built,
        {
          transcodeSlots: { acquire: () => ok(), release: () => {} },
          metadataLanguage: () => DEFAULT_METADATA_LANGUAGE,
        },
        {
          logoDownloader: createTvLogoDownloader({ allowLoopback: true }),
          programmeImageDownloader: createTvLogoDownloader({ allowLoopback: true }),
        },
      )
      return { tv: module.routes, adminTv: module.adminRoutes }
    },
  })
  platform = t.platform
  iptv.setGuideNow(() => t.clock.now())
  const { cookie } = await t.completeSetup()
  const zoe = await t.addUser()
  cookies = { admin: cookie, user: sessionCookieOf(await t.login('zoe', zoe.password)) }
})
afterEach(async () => {
  await module.stop()
  iptv.requests.length = 0
  temp.cleanup()
})

const request = (method: string, path: string, body?: unknown, as: 'admin' | 'user' = 'user') =>
  t.as(cookies[as]).send(method, `/api/v1${path}`, body)

const runJobs = async (types: readonly JobType[]) => {
  const handlers: Partial<Record<JobType, JobHandler>> = module.jobHandlers
  const ran: string[] = []
  for (;;) {
    const job = platform.jobRepository.claimNext({ types, now: t.clock.now() })
    if (job === undefined) return ran
    const handler = handlers[job.type]
    if (handler === undefined) throw new Error(`no handler for ${job.type}`)
    const result = await handler.run(job.payload, {
      job,
      signal: new AbortController().signal,
      reportProgress: () => {},
      logger: silentLogger,
    })
    if (result.ok) platform.jobRepository.complete({ id: job.id, finishedAt: t.clock.now() })
    else
      platform.jobRepository.fail({
        id: job.id,
        error: { code: result.error.code, message: result.error.message },
        finishedAt: t.clock.now(),
      })
    ran.push(`${job.type} ${result.ok ? 'done' : result.error.code}`)
  }
}

/** `playlist.m3u` (its guide announced gzipped by `url-tvg`), the News and Local groups on. */
const guidedSource = async (settings: Record<string, string> = {}) => {
  const created = await request(
    'POST',
    '/admin/tv/sources',
    {
      name: 'Provider',
      settings: { kind: 'm3u', playlistUrl: iptv.at('/m3u/playlist.m3u'), ...settings },
    },
    'admin',
  )
  const { id } = (await created.json()) as { id: string }
  await runJobs(['refresh_tv_source'])
  const detail: AdminTvSourceDetailDto = adminTvSourceDetailDtoSchema.parse(
    await (await request('GET', `/admin/tv/sources/${id}`, undefined, 'admin')).json(),
  )
  for (const group of detail.groups.filter((g) => ['News', 'Local'].includes(g.name)))
    await request('PATCH', `/admin/tv/sources/${id}/groups/${group.id}`, { enabled: true }, 'admin')
  return id
}

const channels = async (): Promise<TvChannelsResponse> =>
  tvChannelsResponseSchema.parse(await (await request('GET', '/tv/channels')).json())

const byName = (response: TvChannelsResponse, name: string) => {
  const channel = response.items.find((item) => item.name === name)
  if (channel === undefined) throw new Error(`no channel ${name}`)
  return channel
}

const programmeRows = () =>
  platform.db.$client.query('SELECT title FROM tv_programmes ORDER BY title').all() as {
    title: string
  }[]

describe('the guide (§29.3) on SQLite against a test provider', () => {
  test('read after the refresh: now and next of the enabled channels, in the server language', async () => {
    await guidedSource()
    expect(await runJobs(['refresh_tv_guide', 'fetch_tv_logos'])).toContain('refresh_tv_guide done')
    expect(iptv.requests.some((r) => r.path === '/xmltv/guide.xml.gz')).toBe(true)

    const listed = await channels()
    const now = t.clock.now().getTime()
    const at = (minutes: number) => new Date(now + minutes * minute).toISOString()
    for (const name of ['News One HD', 'News One FHD']) {
      expect(byName(listed, name)).toMatchObject({
        favorite: false,
        now: { title: 'Le journal', startAt: at(-30), endAt: at(30) },
        next: { title: 'La météo', startAt: at(30), endAt: at(90) },
      })
    }
    const talkShow = byName(listed, 'News Two').now
    expect(talkShow).toEqual({
      id: expect.any(String),
      title: 'Talk show',
      // `xmltv_ns` 2.4: season 3, episode 5; an `ftp` icon is no image.
      episode: { season: 3, episode: 5 },
      kind: 'entertainment',
      startAt: at(-10),
      endAt: at(50),
    })
    // Matched by display name; the last programme without a stop is dropped.
    expect(byName(listed, 'Local Channel')).toMatchObject({
      now: { title: 'Le 12/13 <local>', startAt: at(-20), endAt: at(40) },
    })
    expect(byName(listed, 'Local Channel').next).toBeUndefined()
    expect(byName(listed, 'Bare Name').now).toBeUndefined()
    // Kept from 6 hours ago (Matinale ended 30 minutes ago), never 3 days ahead.
    expect(programmeRows().map((row) => row.title)).toEqual([
      'La météo',
      'La météo',
      'Le 12/13 <local>',
      'Le journal',
      'Le journal',
      'Matinale',
      'Matinale',
      'Talk show',
    ])

    const guide = tvGuideResponseSchema.parse(await (await request('GET', '/tv/guide')).json())
    expect(guide.items).toHaveLength(4)
    expect(guide.items.find((item) => item.channelId === byName(listed, 'News Two').id)).toEqual({
      channelId: byName(listed, 'News Two').id,
      now: talkShow,
    })

    // An hour later: what ended is gone, what follows is now.
    t.clock.advance(60 * minute)
    expect(byName(await channels(), 'News One HD')).toMatchObject({
      now: { title: 'La météo' },
    })
    expect(byName(await channels(), 'News One HD').next).toBeUndefined()
  })

  test("the settings' XMLTV URL first; a failed read keeps the guide; no guide clears it", async () => {
    const id = await guidedSource({ guideUrl: iptv.at('/xmltv/guide.xml?encoding=gzip') })
    await runJobs(['refresh_tv_guide'])
    expect(iptv.requests.some((r) => r.path === '/xmltv/guide.xml?encoding=gzip')).toBe(true)
    expect(programmeRows()).toHaveLength(8)

    await request(
      'PATCH',
      `/admin/tv/sources/${id}`,
      { settings: { kind: 'm3u', guideUrl: iptv.at('/xmltv/expired.html') } },
      'admin',
    )
    expect(await runJobs(['refresh_tv_guide'])).toEqual(['refresh_tv_guide tv/guide_invalid'])
    expect(programmeRows()).toHaveLength(8)
    const notifications = platform.db.$client
      .query("SELECT kind FROM notifications WHERE kind = 'job/failed'")
      .all()
    expect(notifications).toEqual([])

    await request(
      'PATCH',
      `/admin/tv/sources/${id}`,
      { settings: { kind: 'm3u', guideUrl: iptv.at('/xmltv/missing.xml') } },
      'admin',
    )
    expect(await runJobs(['refresh_tv_guide'])).toEqual(['refresh_tv_guide tv/guide_unreachable'])
    expect(programmeRows()).toHaveLength(8)

    // Disabling every channel: the next read deletes the programmes without fetching.
    const detail = adminTvSourceDetailDtoSchema.parse(
      await (await request('GET', `/admin/tv/sources/${id}`, undefined, 'admin')).json(),
    )
    for (const group of detail.groups)
      await request(
        'PATCH',
        `/admin/tv/sources/${id}/groups/${group.id}`,
        { enabled: false },
        'admin',
      )
    t.clock.advance(6 * 60 * minute)
    iptv.requests.length = 0
    expect(await runJobs(['refresh_tv_guide'])).toEqual([])
    expect(module.scheduledTasks?.find((task) => task.name === 'tv-guide-refresh')).toBeDefined()
    await module.scheduledTasks?.find((task) => task.name === 'tv-guide-refresh')?.run()
    expect(await runJobs(['refresh_tv_guide'])).toEqual(['refresh_tv_guide done'])
    expect(iptv.requests.filter((r) => r.path.startsWith('/xmltv/'))).toEqual([])
    expect(programmeRows()).toEqual([])
  })
})

describe('the richer guide (§29.3, §29.7) on SQLite against a test provider', () => {
  const enableGroups = async (sourceId: string, names: readonly string[]) => {
    const detail = adminTvSourceDetailDtoSchema.parse(
      await (await request('GET', `/admin/tv/sources/${sourceId}`, undefined, 'admin')).json(),
    )
    for (const group of detail.groups.filter((g) => names.includes(g.name)))
      await request(
        'PATCH',
        `/admin/tv/sources/${sourceId}/groups/${group.id}`,
        { enabled: true },
        'admin',
      )
  }
  const adminChannels = async (sourceId: string) =>
    adminTvChannelsPageSchema.parse(
      await (
        await request('GET', `/admin/tv/sources/${sourceId}/channels?limit=100`, undefined, 'admin')
      ).json(),
    ).items

  test('kinds, episodes, images, the detail; matching by suffix and name; the admin choice', async () => {
    const id = await guidedSource()
    await enableGroups(id, ['Kids', 'Sports, Live'])
    expect(await runJobs(['refresh_tv_guide'])).toEqual(['refresh_tv_guide done'])
    expect(await runJobs(['fetch_tv_programme_images'])).toEqual(['fetch_tv_programme_images done'])
    // Downloaded once per URL (two channels share the journal's), the failed one tried once.
    expect(iptv.requests.filter((r) => r.path === '/logos/journal.jpg')).toHaveLength(1)
    expect(iptv.requests.filter((r) => r.path === '/logos/missing-cartoons.png')).toHaveLength(1)

    const listed = await channels()
    const journal = byName(listed, 'News One HD').now
    expect(journal).toMatchObject({ title: 'Le journal', kind: 'news' })
    expect(journal?.imageUrl).toBe(`/api/v1/tv/programmes/${journal?.id}/image`)
    expect(byName(listed, 'News One FHD').now?.imageUrl).toBeDefined()
    const image = await request('GET', `/tv/programmes/${journal?.id}/image`)
    expect(image.status).toBe(200)
    expect(image.headers.get('content-type')).toBe('image/jpeg')
    expect(image.headers.get('cache-control')).toBe('private, max-age=3600')

    // `kids.one@SD` takes `kids.one`; Sport Two its normalised name.
    expect(byName(listed, 'Kids One')).toMatchObject({
      kind: 'kids',
      now: { title: 'Dessins animés du matin', kind: 'kids', episode: { label: 'S01E03' } },
    })
    expect(byName(listed, 'Kids One').now?.imageUrl).toBeUndefined()
    expect(byName(listed, 'Sport Two')).toMatchObject({
      kind: 'sport',
      now: { title: 'Grand prix', kind: 'sport' },
    })
    expect(byName(listed, 'Local Channel').kind).toBe('other')

    const detail = await request('GET', `/tv/programmes/${journal?.id}`)
    expect(detail.status).toBe(200)
    expect(tvProgrammeDetailDtoSchema.parse(await detail.json())).toEqual({
      id: journal?.id ?? '',
      channelId: byName(listed, 'News One HD').id,
      title: 'Le journal',
      subtitle: 'Édition de la mi-journée',
      description: 'Les titres du jour & la météo.',
      kind: 'news',
      categories: ['Information', 'News'],
      startAt: journal?.startAt ?? '',
      endAt: journal?.endAt ?? '',
      imageUrl: journal?.imageUrl,
      next: expect.objectContaining({ title: 'La météo' }),
    })
    const missing = await request('GET', '/tv/programmes/nope')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'tv/programme_not_found' } })

    // What matched, for the admin; the guide's channels to pick from.
    const before = await adminChannels(id)
    const row = (name: string) => before.find((channel) => channel.name === name)
    expect(row('Kids One')).toMatchObject({
      guideChannel: { id: 'kids.one', name: 'Les enfants', manual: false },
      guideMatched: true,
    })
    expect(row('Bare Name')).toMatchObject({ guideMatched: false })
    expect(row('Bare Name')?.guideChannel).toBeUndefined()
    const picker = adminTvGuideChannelsPageSchema.parse(
      await (
        await request('GET', `/admin/tv/sources/${id}/guide-channels?q=ENFANTS`, undefined, 'admin')
      ).json(),
    )
    expect(picker).toEqual({ items: [{ id: 'kids.one', names: ['Les enfants'] }], total: 1 })

    // The admin's choice wins, survives a source refresh, and "Automatic" clears it.
    const bare = row('Bare Name')?.id ?? ''
    const chosen = await request(
      'PATCH',
      `/admin/tv/channels/${bare}`,
      // Any case: guide channel ids match ignoring it (§29.3).
      { guideChannel: 'Sport.Two.example' },
      'admin',
    )
    expect(chosen.status).toBe(200)
    expect(await chosen.json()).toMatchObject({
      guideChannel: { id: 'Sport.Two.example', manual: true },
    })
    await request('POST', `/admin/tv/sources/${id}/refresh`, undefined, 'admin')
    expect(await runJobs(['refresh_tv_source', 'refresh_tv_guide'])).toEqual([
      'refresh_tv_source done',
      'refresh_tv_guide done',
    ])
    const after = await channels()
    expect(byName(after, 'Bare Name').now?.title).toBe('Grand prix')
    expect((await adminChannels(id)).find((channel) => channel.id === bare)).toMatchObject({
      guideChannel: {
        id: 'Sport.Two.example',
        name: 'SPORT TWO [Geo-blocked] (1080p)',
        manual: true,
      },
      guideMatched: true,
    })
    // A programme read again keeps its id.
    expect(byName(after, 'News One HD').now?.id).toBe(journal?.id)
    await request('PATCH', `/admin/tv/channels/${bare}`, { guideChannel: '' }, 'admin')
    await runJobs(['refresh_tv_guide'])
    expect(byName(await channels(), 'Bare Name').now).toBeUndefined()
    const empty = await request('PATCH', `/admin/tv/channels/${bare}`, {}, 'admin')
    expect(empty.status).toBe(400)

    // Without Live TV access, no programme exists for the profile; the admin still sees images.
    await request('PATCH', '/profiles/profile-zoe', { liveTv: false }, 'admin')
    for (const path of [`/tv/programmes/${journal?.id}`, `/tv/programmes/${journal?.id}/image`]) {
      const refused = await request('GET', path)
      expect(refused.status).toBe(404)
      expect(await refused.json()).toMatchObject({ error: { code: 'tv/programme_not_found' } })
    }
    expect(
      (await request('GET', `/tv/programmes/${journal?.id}/image`, undefined, 'admin')).status,
    ).toBe(200)
  })
})

describe('the guide grid read, GET /tv/schedule (§29.7)', () => {
  test('programmes overlapping the range, in the order asked, bounded, behind Live TV access', async () => {
    await guidedSource()
    await runJobs(['refresh_tv_guide'])
    const listed = await channels()
    const newsOne = byName(listed, 'News One HD').id
    const newsTwo = byName(listed, 'News Two').id
    const local = byName(listed, 'Local Channel').id
    const now = t.clock.now().getTime()
    const at = (minutes: number) => new Date(now + minutes * minute).toISOString()
    const schedule = (query: Record<string, string>) =>
      request('GET', `/tv/schedule?${new URLSearchParams(query).toString()}`)
    const read = async (query: Record<string, string>) => {
      const response = await schedule(query)
      expect(response.status).toBe(200)
      return tvScheduleResponseSchema.parse(await response.json())
    }

    const window = await read({
      from: at(-60),
      to: at(40),
      channels: [newsTwo, 'unknown', newsOne, newsTwo, local].join(','),
    })
    expect(window.items.map((item) => item.channelId)).toEqual([newsTwo, newsOne, local])
    expect(window.items[1]?.programmes.map((p) => [p.title, p.startAt, p.endAt])).toEqual([
      ['Matinale', at(-120), at(-30)],
      ['Le journal', at(-30), at(30)],
      ['La météo', at(30), at(90)],
    ])
    // Compact: no subtitle, description nor image.
    expect(window.items[0]?.programmes).toEqual([
      {
        id: expect.any(String),
        title: 'Talk show',
        startAt: at(-10),
        endAt: at(50),
        kind: 'entertainment',
        episode: { season: 3, episode: 5 },
      },
    ])
    // A programme ending at `from` or starting at `to` is not in it.
    expect(
      (await read({ from: at(30), to: at(90), channels: newsOne })).items[0]?.programmes.map(
        (p) => p.title,
      ),
    ).toEqual(['La météo'])
    expect((await read({ from: at(100), to: at(200), channels: newsOne })).items).toEqual([])

    // Bounds: an empty, reversed or longer than 24 hours range, no channel, too many channels.
    const tooMany = Array.from({ length: 101 }, (_, index) => `c${index}`).join(',')
    for (const query of [
      { from: at(0), to: at(0), channels: newsOne },
      { from: at(60), to: at(0), channels: newsOne },
      { from: at(0), to: at(24 * 60 + 1), channels: newsOne },
      { from: at(0), to: at(60), channels: '' },
      { from: at(0), to: at(60), channels: tooMany },
      { from: 'yesterday', to: at(60), channels: newsOne },
    ]) {
      const refused = await schedule(query)
      expect(refused.status).toBe(400)
      expect(await refused.json()).toMatchObject({ error: { code: 'common/validation_failed' } })
    }
    expect((await schedule({ from: at(0), to: at(24 * 60), channels: newsOne })).status).toBe(200)

    await request('PATCH', '/profiles/profile-zoe', { liveTv: false }, 'admin')
    expect(await read({ from: at(-60), to: at(40), channels: newsOne })).toEqual({ items: [] })
  })
})

describe('favourites (§29.7)', () => {
  test('added last, listed in that order, removed; a channel not listed is not found', async () => {
    await guidedSource()
    const listed = await channels()
    const local = byName(listed, 'Local Channel').id
    const news = byName(listed, 'News Two').id
    expect((await request('PUT', `/tv/channels/${local}/favorite`)).status).toBe(204)
    expect((await request('PUT', `/tv/channels/${news}/favorite`)).status).toBe(204)
    expect((await request('PUT', `/tv/channels/${local}/favorite`)).status).toBe(204)
    const after = await channels()
    expect(after.favorites).toEqual([local, news])
    expect(byName(after, 'Local Channel').favorite).toBe(true)
    // Each profile its own.
    const own = tvChannelsResponseSchema.parse(
      await (await request('GET', '/tv/channels', undefined, 'admin')).json(),
    )
    expect(own.favorites).toEqual([])

    expect((await request('DELETE', `/tv/channels/${local}/favorite`)).status).toBe(204)
    expect((await request('DELETE', `/tv/channels/${local}/favorite`)).status).toBe(204)
    expect((await channels()).favorites).toEqual([news])

    const missing = await request('PUT', '/tv/channels/nope/favorite')
    expect(missing.status).toBe(404)
    expect(await missing.json()).toMatchObject({ error: { code: 'tv/channel_not_found' } })
  })
})

describe('Live TV access (§29.6)', () => {
  test('switched off by an admin: every viewer route answers as if no channel existed', async () => {
    await guidedSource()
    await runJobs(['refresh_tv_guide', 'fetch_tv_logos'])
    const listed = await channels()
    const channel = byName(listed, 'News One HD')
    expect(channel.logoUrl).toBeDefined()
    await request('PUT', `/tv/channels/${channel.id}/favorite`)

    // Set by an admin only (§29.6): the profile cannot turn it off itself either.
    const own = await request('PATCH', '/profiles/profile-zoe', { liveTv: false })
    expect(own.status).toBe(403)
    expect(await own.json()).toMatchObject({ error: { code: 'profile/admin_only' } })
    const off = await request('PATCH', '/profiles/profile-zoe', { liveTv: false }, 'admin')
    expect(off.status).toBe(200)
    expect(await off.json()).toMatchObject({ liveTv: false })

    expect(await channels()).toEqual({ groups: [], items: [], favorites: [] })
    expect(await (await request('GET', '/tv/guide')).json()).toEqual({ items: [] })
    const notFound = async (response: Response) => {
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ error: { code: 'tv/channel_not_found' } })
    }
    await notFound(await request('GET', `/tv/channels/${channel.id}/logo`))
    await notFound(await request('PUT', `/tv/channels/${channel.id}/favorite`))
    await notFound(await request('DELETE', `/tv/channels/${channel.id}/favorite`))
    await notFound(
      await request('POST', `/tv/channels/${channel.id}/sessions`, {
        capabilities: { videoCodecs: ['avc1'], audioCodecs: ['mp4a.40.2'], hls: 'mse' },
      }),
    )
    // The admin's own profile is not concerned, its Admin → TV logos neither.
    expect(
      (await request('GET', `/tv/channels/${channel.id}/logo`, undefined, 'admin')).status,
    ).toBe(200)

    // Nor back on; an admin can, and its favourites are back.
    const self = await request('PATCH', '/profiles/profile-zoe', { liveTv: true })
    expect(self.status).toBe(403)
    expect(await self.json()).toMatchObject({ error: { code: 'profile/admin_only' } })
    await request('PATCH', '/profiles/profile-zoe', { liveTv: true }, 'admin')
    expect((await channels()).favorites).toEqual([channel.id])
  })
})

describe('a Freebox source (§29.2, §29.3) on SQLite against a replayed box', () => {
  test('lists its channels, gets their logos and reads the guide hour by hour', async () => {
    const created = await request(
      'POST',
      '/admin/tv/sources',
      { name: 'Freebox', settings: { kind: 'freebox', address: iptv.url } },
      'admin',
    )
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source done'])

    const detail = adminTvSourceDetailDtoSchema.parse(
      await (await request('GET', `/admin/tv/sources/${id}`, undefined, 'admin')).json(),
    )
    expect(detail).toMatchObject({
      kind: 'freebox',
      settings: { kind: 'freebox', address: iptv.url },
      state: 'ready',
      channelCount: 6,
      enabledChannelCount: 0,
      groups: [{ name: 'Freebox TV', enabled: false, channelCount: 6 }],
    })
    const [group] = detail.groups
    if (group === undefined) throw new Error('no group')
    await request('PATCH', `/admin/tv/sources/${id}/groups/${group.id}`, { enabled: true }, 'admin')
    expect((await runJobs(['refresh_tv_guide', 'fetch_tv_logos'])).sort()).toEqual([
      'fetch_tv_logos done',
      'refresh_tv_guide done',
    ])

    expect(iptv.requests.filter((r) => r.path.includes('/epg/by_time/'))).toHaveLength(79)
    expect(iptv.requests.filter((r) => r.path.startsWith('/api/latest/tv/img/'))).toHaveLength(6)

    const listed = await channels()
    expect(listed.groups.map((g) => g.name)).toEqual(['Freebox TV'])
    expect(listed.items.map((item) => [item.number, item.name])).toEqual([
      [2, 'France 2'],
      [3, "France 3 Provence-Alpes-Côte d'Azur"],
      [7, 'Arte'],
      [28, 'Paris Première'],
      [939, 'Télé Bocal'],
      [940, 'TV78'],
    ])
    const now = Math.floor(t.clock.now().getTime() / minute) * minute
    const at = (minutes: number) => new Date(now + minutes * minute).toISOString()
    expect(byName(listed, 'France 2')).toMatchObject({
      logoUrl: `/api/v1/tv/channels/${byName(listed, 'France 2').id}/logo`,
      now: { title: "Ça commence aujourd'hui", startAt: at(-8), endAt: at(62) },
      next: { title: "Je t'aime, etc.", startAt: at(62), endAt: at(112) },
    })
    expect(byName(listed, 'Paris Première')).toMatchObject({
      now: { title: 'Elementary', startAt: at(-3), endAt: at(42) },
      next: { title: 'Elementary', startAt: at(42) },
    })
    expect(byName(listed, 'TV78').now).toBeUndefined()
    // France 2's four programmes (3 days are kept), and the others' within 6 hours ago.
    expect(programmeRows()).toHaveLength(9)
  })

  test('a patch keeps its kind; a new address queues a refresh', async () => {
    const created = await request(
      'POST',
      '/admin/tv/sources',
      { name: 'Freebox', settings: { kind: 'freebox', address: iptv.url } },
      'admin',
    )
    const { id } = (await created.json()) as { id: string }
    expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source done'])

    const other = await request(
      'PATCH',
      `/admin/tv/sources/${id}`,
      { settings: { kind: 'm3u' } },
      'admin',
    )
    expect(other.status).toBe(422)
    expect(await other.json()).toMatchObject({ error: { code: 'tv/source_invalid' } })
    expect(await runJobs(['refresh_tv_source'])).toEqual([])

    const https = await request(
      'PATCH',
      `/admin/tv/sources/${id}`,
      { settings: { kind: 'freebox', address: 'https://mafreebox.freebox.fr' } },
      'admin',
    )
    expect(https.status).toBe(400)

    iptv.requests.length = 0
    const moved = await request(
      'PATCH',
      `/admin/tv/sources/${id}`,
      { settings: { kind: 'freebox', address: `${iptv.url}/` } },
      'admin',
    )
    expect(moved.status).toBe(200)
    expect(await moved.json()).toMatchObject({
      state: 'refreshing',
      settings: { kind: 'freebox', address: `${iptv.url}/` },
    })
    expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source done'])
    expect(iptv.requests.map((r) => r.path)).toContain('/api_version')
  })
})
