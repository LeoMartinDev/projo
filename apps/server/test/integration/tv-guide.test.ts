import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'
import {
  type AdminTvSourceDetailDto,
  adminTvSourceDetailDtoSchema,
  type TvChannelsResponse,
  tvChannelsResponseSchema,
  tvGuideResponseSchema,
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
        { logoDownloader: createTvLogoDownloader({ allowLoopback: true }) },
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
    expect(byName(listed, 'News Two').now).toEqual({
      title: 'Talk show',
      startAt: at(-10),
      endAt: at(50),
    })
    // Matched by display name; the last programme without a stop is dropped.
    expect(byName(listed, 'Local Channel')).toMatchObject({
      now: { title: 'Le 12/13 <local>', startAt: at(-20), endAt: at(40) },
    })
    expect(byName(listed, 'Local Channel').next).toBeUndefined()
    expect(byName(listed, 'Bare Name').now).toBeUndefined()
    expect(programmeRows().map((row) => row.title)).toEqual([
      'La météo',
      'La météo',
      'Le 12/13 <local>',
      'Le journal',
      'Le journal',
      'Talk show',
    ])

    const guide = tvGuideResponseSchema.parse(await (await request('GET', '/tv/guide')).json())
    expect(guide.items).toHaveLength(4)
    expect(guide.items.find((item) => item.channelId === byName(listed, 'News Two').id)).toEqual({
      channelId: byName(listed, 'News Two').id,
      now: { title: 'Talk show', startAt: at(-10), endAt: at(50) },
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
    expect(programmeRows()).toHaveLength(6)

    await request(
      'PATCH',
      `/admin/tv/sources/${id}`,
      { settings: { kind: 'm3u', guideUrl: iptv.at('/xmltv/expired.html') } },
      'admin',
    )
    expect(await runJobs(['refresh_tv_guide'])).toEqual(['refresh_tv_guide tv/guide_invalid'])
    expect(programmeRows()).toHaveLength(6)
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
    expect(programmeRows()).toHaveLength(6)

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
