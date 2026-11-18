import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { ok } from '@projo/shared'
import {
  type AdminTvChannelsPage,
  type AdminTvSourceDetailDto,
  type AdminTvSourceDto,
  adminTvChannelsPageSchema,
  adminTvSourceDetailDtoSchema,
  adminTvSourcesResponseSchema,
} from '@projo/shared/api/tv'

import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { buildTvModule } from '../../src/entrypoints/modules/tv.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { DEFAULT_METADATA_LANGUAGE } from '../../src/infrastructure/sqlite/metadata-settings-repository.ts'
import { createSqliteJobTargetLabels } from '../../src/infrastructure/sqlite/job-target-labels.ts'
import { stripNulls } from '../../src/infrastructure/sqlite/rows.ts'
import { createTvLogoDownloader } from '../../src/infrastructure/tv/logo-downloader.ts'
import { createAuthTestApp, sessionCookieOf } from '../support/auth-app.ts'
import type { ManualClock } from '../support/clock.ts'
import { createTempDir } from '../support/database.ts'
import { type IptvServer, PNG_BYTES, startIptvServer } from '../support/iptv-server.ts'
import { createCapturingLogger, silentLogger } from '../support/logger.ts'

const day = 24 * 60 * 60_000

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
})
afterAll(() => iptv.stop())

let temp: ReturnType<typeof createTempDir>
let t: ReturnType<typeof createAuthTestApp>
let platform: Platform
let clock: ManualClock
let module: ReturnType<typeof buildTvModule>
let logs: ReturnType<typeof createCapturingLogger>
let cookies: { admin: string; user: string }
let role: 'admin' | 'user'

beforeEach(async () => {
  temp = createTempDir()
  const paths = dataPathsFor(temp.path.replaceAll('\\', '/'))
  if (!ensureDataLayout(paths).ok) throw new Error('no data layout')
  logs = createCapturingLogger()
  t = createAuthTestApp({
    paths,
    jobs: 'queue',
    routes: (built) => {
      module = buildTvModule(
        { ...built, logger: logs.logger },
        {
          transcodeSlots: { acquire: () => ok(), release: () => {} },
          metadataLanguage: () => DEFAULT_METADATA_LANGUAGE,
        },
        // The test provider is on loopback, which logo downloads refuse by default (§29.2).
        { logoDownloader: createTvLogoDownloader({ allowLoopback: true }) },
      )
      return { tv: module.routes, adminTv: module.adminRoutes }
    },
  })
  platform = t.platform
  clock = t.clock
  const { cookie } = await t.completeSetup()
  const zoe = await t.addUser()
  cookies = { admin: cookie, user: sessionCookieOf(await t.login('zoe', zoe.password)) }
  role = 'admin'
})
afterEach(() => {
  failures = []
  iptv.requests.length = 0
  iptv.restore('/m3u/playlist.m3u')
  temp.cleanup()
})

/** A request of the signed-in admin (or of `zoe`, a user, with `role = 'user'`). */
const request = (method: string, path: string, body?: unknown) =>
  t.as(cookies[role]).send(method, `/api/v1${path}`, body)

const handlers = (): Partial<Record<JobType, JobHandler>> => module.jobHandlers

/** Errors the handlers returned, as the runner would log them. */
let failures: { code: string; context?: Record<string, unknown>; cause?: unknown }[] = []
const runJobs = async (types: readonly JobType[]) => {
  const ran: string[] = []
  for (;;) {
    const job = platform.jobRepository.claimNext({ types, now: clock.now() })
    if (job === undefined) return ran
    const handler = handlers()[job.type]
    if (handler === undefined) throw new Error(`no handler for ${job.type}`)
    const result = await handler.run(job.payload, {
      job,
      signal: new AbortController().signal,
      reportProgress: () => {},
      logger: silentLogger,
    })
    if (result.ok) platform.jobRepository.complete({ id: job.id, finishedAt: clock.now() })
    else failures.push(result.error)
    if (!result.ok)
      platform.jobRepository.fail({
        id: job.id,
        error: { code: result.error.code, message: result.error.message },
        finishedAt: clock.now(),
      })
    ran.push(`${job.type} ${result.ok ? 'done' : result.error.code}`)
  }
}

const createSource = async (): Promise<AdminTvSourceDto> => {
  const response = await request('POST', '/admin/tv/sources', {
    name: 'Provider',
    settings: {
      kind: 'm3u',
      playlistUrl: iptv.at('/m3u/playlist.m3u?username=leo&password=secret'),
      guideUrl: iptv.at('/xmltv.php?password=secret'),
    },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as AdminTvSourceDto
}

const detail = async (id: string): Promise<AdminTvSourceDetailDto> =>
  adminTvSourceDetailDtoSchema.parse(await (await request('GET', `/admin/tv/sources/${id}`)).json())

const channels = async (id: string, query = ''): Promise<AdminTvChannelsPage> =>
  adminTvChannelsPageSchema.parse(
    await (await request('GET', `/admin/tv/sources/${id}/channels${query}`)).json(),
  )

const groupId = (source: AdminTvSourceDetailDto, name: string): string => {
  const group = source.groups.find((g) => g.name === name)
  if (group === undefined) throw new Error(`no group ${name}`)
  return group.id
}

const openNotifications = () =>
  (
    platform.db.$client
      .query('SELECT kind, context FROM notifications WHERE resolved_at IS NULL')
      .all() as Record<string, unknown>[]
  ).map(stripNulls)

describe('live TV sources (§29.2) on SQLite against a test provider', () => {
  test('a new source is refreshed into groups and disabled channels, secrets masked', async () => {
    const created = await createSource()
    expect(created).toMatchObject({
      name: 'Provider',
      kind: 'm3u',
      state: 'refreshing',
      settings: {
        kind: 'm3u',
        playlistUrl: `${new URL(iptv.url).origin}/…`,
        guideUrl: `${new URL(iptv.url).origin}/…`,
      },
    })

    expect(await runJobs(['refresh_tv_source', 'fetch_tv_logos'])).toEqual([
      'refresh_tv_source done',
      'fetch_tv_logos done',
    ])
    const source = await detail(created.id)
    expect(source).toMatchObject({
      state: 'ready',
      channelCount: 8,
      enabledChannelCount: 0,
      failureCount: 0,
    })
    expect(source.groups.map((g) => [g.name, g.channelCount, g.enabled])).toEqual([
      ['News', 3, false],
      ['Sports, Live', 2, false],
      ['Kids', 1, false],
      ['Local', 2, false],
    ])
    const listed = adminTvSourcesResponseSchema.parse(
      await (await request('GET', '/admin/tv/sources')).json(),
    )
    const everything = JSON.stringify([listed, source, await channels(created.id)])
    expect(everything).not.toContain('secret')
    expect(everything).not.toContain('/live/')
    expect(iptv.requests.filter((r) => r.path.startsWith('/logos/'))).toEqual([])
  })

  test('the admin searches and pages channels, enables a group and gets its logos', async () => {
    const { id } = await createSource()
    await runJobs(['refresh_tv_source', 'fetch_tv_logos'])
    const source = await detail(id)

    const page = await channels(id, '?limit=3')
    expect(page.items.map((c) => c.name)).toEqual(['News One HD', 'News One FHD', 'News Two'])
    expect(page).toMatchObject({ total: 8, nextCursor: '3' })
    expect((await channels(id, '?q=NEWS%20one')).items.map((c) => c.name)).toEqual([
      'News One HD',
      'News One FHD',
    ])
    expect(
      (await channels(id, `?groupId=${groupId(source, 'Local')}`)).items.map((c) => c.name),
    ).toEqual(['Local Channel', 'Bare Name'])

    const switched = await request(
      'PATCH',
      `/admin/tv/sources/${id}/groups/${groupId(source, 'News')}`,
      { enabled: true },
    )
    expect(await switched.json()).toMatchObject({
      name: 'News',
      enabled: true,
      channelCount: 3,
      enabledChannelCount: 3,
    })
    expect(await runJobs(['fetch_tv_logos'])).toEqual(['fetch_tv_logos done'])
    const news = await channels(id, `?groupId=${groupId(source, 'News')}`)
    expect(news.items.map((c) => [c.name, c.enabled, c.hasLogo])).toEqual([
      ['News One HD', true, true],
      ['News One FHD', true, true],
      ['News Two', true, false],
    ])
    const [newsOne] = news.items
    if (newsOne === undefined) throw new Error('no channel')
    const logo = await request('GET', `/tv/channels/${newsOne.id}/logo`)
    expect(logo.status).toBe(200)
    expect(logo.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG_BYTES)
    expect(readdirSync(join(temp.path, 'images', 'tv'))).toHaveLength(2)

    const off = await request('PATCH', `/admin/tv/channels/${newsOne.id}`, { enabled: false })
    expect(await off.json()).toMatchObject({ id: newsOne.id, enabled: false, hasLogo: true })
    role = 'user'
    expect((await request('GET', `/tv/channels/${newsOne.id}/logo`)).status).toBe(404)
    role = 'admin'
    expect((await request('GET', `/tv/channels/${newsOne.id}/logo`)).status).toBe(200)
  })

  test('channels keep their ids across refreshes; gone ones are hidden then deleted', async () => {
    const { id } = await createSource()
    await runJobs(['refresh_tv_source'])
    const news = groupId(await detail(id), 'News')
    await request('PATCH', `/admin/tv/sources/${id}/groups/${news}`, { enabled: true })
    const before = new Map((await channels(id)).items.map((c) => [c.name, c.id]))

    const changed = iptv
      .fixture('playlist.m3u')
      .replace('News One FHD', 'News One UHD')
      .replace(/#EXTINF[^\n]*Kids One\n[^\n]*\n/u, '')
    iptv.override('/m3u/playlist.m3u', changed)
    await request('POST', `/admin/tv/sources/${id}/refresh`)
    await runJobs(['refresh_tv_source'])

    const after = new Map((await channels(id)).items.map((c) => [c.name, c]))
    expect(after.get('News One HD')?.id).toBe(before.get('News One HD'))
    expect(after.get('News One UHD')).toMatchObject({ enabled: true })
    expect(after.get('News One UHD')?.id).not.toBe(before.get('News One FHD'))
    expect(after.has('Kids One')).toBe(false)
    const source = await detail(id)
    expect(source.channelCount).toBe(7)
    expect(source.groups.find((g) => g.name === 'Kids')?.channelCount).toBe(0)

    clock.advance(7 * day)
    await request('POST', `/admin/tv/sources/${id}/refresh`)
    await runJobs(['refresh_tv_source'])
    expect((await detail(id)).groups.map((g) => g.name)).toEqual(['News', 'Sports, Live', 'Local'])
  })

  test('three failed refreshes raise tv/source_unreachable; a success resolves it', async () => {
    const { id } = await createSource()
    await runJobs(['refresh_tv_source'])
    iptv.override('/m3u/playlist.m3u', { status: 503 })
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      clock.advance(1_000)
      await request('POST', `/admin/tv/sources/${id}/refresh`)
      expect(await runJobs(['refresh_tv_source'])).toEqual([
        'refresh_tv_source tv/source_unreachable',
      ])
    }
    expect(openNotifications()).toEqual([
      {
        kind: 'tv/source_unreachable',
        context: JSON.stringify({
          tvSourceId: id,
          name: 'Provider',
          code: 'tv/source_unreachable',
          failures: 3,
          key: id,
        }),
      },
    ])
    expect(await detail(id)).toMatchObject({
      state: 'error',
      failureCount: 3,
      channelCount: 8,
      lastError: { code: 'tv/source_unreachable' },
    })

    iptv.restore('/m3u/playlist.m3u')
    await request('POST', `/admin/tv/sources/${id}/refresh`)
    await runJobs(['refresh_tv_source'])
    expect(openNotifications()).toEqual([])
    expect(await detail(id)).toMatchObject({ state: 'ready', failureCount: 0 })
  })

  test('the hourly task queues the daily refresh, named in the jobs list', async () => {
    const { id } = await createSource()
    await runJobs(['refresh_tv_source'])
    const task = module.scheduledTasks.find((t) => t.name === 'tv-sources-refresh')
    await task?.run()
    expect(await runJobs(['refresh_tv_source'])).toEqual([])
    clock.advance(day)
    await task?.run()
    expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source done'])
    const labels = createSqliteJobTargetLabels({ db: platform.db }).labelsOf([
      { kind: 'tv_source', id },
    ])
    expect([...labels.values()]).toEqual([{ label: 'Provider' }])
  })

  test('the admin edits and deletes a source', async () => {
    const { id } = await createSource()
    await runJobs(['refresh_tv_source'])
    const news = groupId(await detail(id), 'News')
    await request('PATCH', `/admin/tv/sources/${id}/groups/${news}`, { enabled: true })
    await runJobs(['fetch_tv_logos'])

    const renamed = await request('PATCH', `/admin/tv/sources/${id}`, {
      name: 'Renamed',
      maxConnections: 2,
      settings: { kind: 'm3u', guideUrl: '', userAgent: 'Box/1' },
    })
    expect(await renamed.json()).toMatchObject({
      name: 'Renamed',
      maxConnections: 2,
      state: 'refreshing',
      settings: { userAgent: 'Box/1' },
    })
    expect((await detail(id)).settings).not.toHaveProperty('guideUrl')
    await runJobs(['refresh_tv_source'])
    expect(iptv.requests.findLast((r) => r.path.startsWith('/m3u/'))?.userAgent).toBe('Box/1')

    const cleared = await request('PATCH', `/admin/tv/sources/${id}`, { maxConnections: '' })
    expect(((await cleared.json()) as AdminTvSourceDto).maxConnections).toBeUndefined()

    expect((await request('DELETE', `/admin/tv/sources/${id}`)).status).toBe(204)
    expect(
      existsSync(join(temp.path, 'images', 'tv')) && readdirSync(join(temp.path, 'images', 'tv')),
    ).toEqual([])
    expect(await (await request('GET', `/admin/tv/sources/${id}`)).json()).toMatchObject({
      error: { code: 'tv/source_not_found' },
    })
    expect((await request('POST', `/admin/tv/sources/${id}/refresh`)).status).toBe(404)
  })

  test("a viewer's <img> loads an enabled channel's logo with the media key (§20)", async () => {
    const { id } = await createSource()
    await runJobs(['refresh_tv_source'])
    const news = groupId(await detail(id), 'News')
    await request('PATCH', `/admin/tv/sources/${id}/groups/${news}`, { enabled: true })
    await runJobs(['fetch_tv_logos'])
    const [first, second] = (await channels(id, `?groupId=${news}`)).items
    if (first === undefined || second === undefined) throw new Error('no channels')
    await request('PATCH', `/admin/tv/channels/${second.id}`, { enabled: false })

    const signIn = await t.json('POST', '/api/v1/auth/login', {
      username: 'zoe',
      password: 'another long password',
      token: true,
      deviceName: 'Living room',
    })
    const { token } = (await signIn.json()) as { token: string }
    const me = await t.request('/api/v1/auth/me', { headers: { authorization: `Bearer ${token}` } })
    const key = encodeURIComponent(((await me.json()) as { mediaKey: string }).mediaKey)

    const logo = await t.request(`/api/v1/tv/channels/${first.id}/logo?key=${key}`)
    expect(logo.status).toBe(200)
    expect(logo.headers.get('content-type')).toBe('image/png')
    expect(logo.headers.get('cache-control')).toBe('private, max-age=3600')
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG_BYTES)
    const disabled = await t.request(`/api/v1/tv/channels/${second.id}/logo?key=${key}`)
    expect(disabled.status).toBe(404)
    expect(await disabled.json()).toMatchObject({ error: { code: 'tv/channel_not_found' } })
    expect((await t.request(`/api/v1/tv/channels/${first.id}/logo`)).status).toBe(401)
  })

  test('a failed refresh never logs nor stores the secret of the playlist URL', async () => {
    const { id } = await createSource()
    // Bun's message for this failure holds the requested URL, query included.
    iptv.override('/m3u/playlist.m3u', { status: 302, location: 'ftp://elsewhere/list.m3u' })
    expect(await runJobs(['refresh_tv_source'])).toEqual([
      'refresh_tv_source tv/source_unreachable',
    ])
    expect(failures).toMatchObject([
      { context: { host: new URL(iptv.url).host, reason: 'unsupported_redirect' } },
    ])
    expect(failures.map((failure) => failure.cause)).toEqual([undefined])
    const warning = logs.lines.find((line) => line.message === 'tv source refresh failed')
    expect(warning?.fields).toMatchObject({ reason: 'unsupported_redirect' })
    const exposed = JSON.stringify([failures, logs.lines, await detail(id), openNotifications()])
    expect(exposed).not.toContain('secret')
    expect(exposed).not.toContain('playlist.m3u')
  })

  test('refuses invalid bodies', async () => {
    const bad = await request('POST', '/admin/tv/sources', {
      name: 'x',
      settings: { kind: 'm3u', playlistUrl: 'file:///etc/passwd' },
    })
    expect(bad.status).toBe(400)
  })
})
