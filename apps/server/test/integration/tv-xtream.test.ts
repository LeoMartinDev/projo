import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'

import type { ClientCapabilities } from '@projo/shared/api/playback'
import {
  type AdminTvSourceDetailDto,
  adminTvSourceDetailDtoSchema,
  adminTvSourcesResponseSchema,
  tvChannelsResponseSchema,
  tvGuideResponseSchema,
  tvSessionDtoSchema,
} from '@projo/shared/api/tv'

import { transcodeSlotsFactory } from '../../src/application/playback/transcode-slots.ts'
import { dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { buildTvModule } from '../../src/entrypoints/modules/tv.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { DEFAULT_METADATA_LANGUAGE } from '../../src/infrastructure/sqlite/metadata-settings-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../src/infrastructure/sqlite/playback-session-repository.ts'
import { createSqlitePlaybackSettings } from '../../src/infrastructure/sqlite/playback-settings.ts'
import { createTvLogoDownloader } from '../../src/infrastructure/tv/logo-downloader.ts'
import { createAuthTestApp, sessionCookieOf } from '../support/auth-app.ts'
import { createTempDir } from '../support/database.ts'
import { type IptvServer, startIptvServer, xtreamCredentials } from '../support/iptv-server.ts'
import { createCapturingLogger } from '../support/logger.ts'
import { hasFfmpeg } from '../support/media.ts'

/**
 * An `xtream` source (§29.2, §29.3, §29.4) on SQLite against the test provider's Xtream panel:
 * the account, its channels and limit, the guide, the relay, and its credentials kept secret.
 */

const capabilities: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
})
afterAll(() => iptv.stop())

let temp: ReturnType<typeof createTempDir>
let t: ReturnType<typeof createAuthTestApp>
let platform: Platform
let module: ReturnType<typeof buildTvModule>
let logs: ReturnType<typeof createCapturingLogger>
let cookies: { admin: string; user: string }

beforeEach(async () => {
  temp = createTempDir()
  const paths = dataPathsFor(temp.path.replaceAll('\\', '/'))
  if (!ensureDataLayout(paths).ok) throw new Error('no data layout')
  logs = createCapturingLogger()
  t = createAuthTestApp({
    paths,
    jobs: 'queue',
    routes: (built) => {
      const transcodeSlots = transcodeSlotsFactory({
        sessionRepository: createSqlitePlaybackSessionRepository({ db: built.db }),
        playbackSettings: createSqlitePlaybackSettings({ db: built.db }),
        clock: built.clock,
        logger: logs.logger,
      })
      module = buildTvModule(
        { ...built, logger: logs.logger },
        { transcodeSlots, metadataLanguage: () => DEFAULT_METADATA_LANGUAGE },
        {
          // The test provider is on loopback, which logo downloads refuse by default (§29.2).
          logoDownloader: createTvLogoDownloader({ allowLoopback: true }),
          live: { timings: { retryDelaysMs: [50, 100, 200], idleStopMs: 300 } },
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
  iptv.setXtreamAccount({})
  iptv.restoreLive()
  iptv.requests.length = 0
  temp.cleanup()
})

const request = (method: string, path: string, body?: unknown, as: 'admin' | 'user' = 'admin') =>
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
      logger: logs.logger,
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

const xtreamSettings = (password: string = xtreamCredentials.password) => ({
  kind: 'xtream',
  serverUrl: `${iptv.url}/`,
  username: xtreamCredentials.username,
  password,
})

const createSource = async (password?: string): Promise<string> => {
  const created = await request('POST', '/admin/tv/sources', {
    name: 'Panel',
    settings: xtreamSettings(password),
  })
  expect(created.status).toBe(201)
  return ((await created.json()) as { id: string }).id
}

const detail = async (id: string): Promise<AdminTvSourceDetailDto> =>
  adminTvSourceDetailDtoSchema.parse(await (await request('GET', `/admin/tv/sources/${id}`)).json())

const enableAll = async (id: string) => {
  for (const group of (await detail(id)).groups)
    await request('PATCH', `/admin/tv/sources/${id}/groups/${group.id}`, { enabled: true })
}

const channels = async () =>
  tvChannelsResponseSchema.parse(
    await (await request('GET', '/tv/channels', undefined, 'user')).json(),
  )

/** Neither credential (raw or percent-encoded), nor the panel's paths, appears in `text`. */
const expectNoCredentials = (text: string, password: string = xtreamCredentials.password) => {
  for (const secret of [xtreamCredentials.username, password, encodeURIComponent(password)])
    expect(text).not.toContain(secret)
  expect(text).not.toContain('player_api')
  expect(text).not.toContain('xmltv.php')
}

/**
 * Every place a credential could leak to: logs, jobs, notifications, the channels' stored
 * upstreams, and the admin's answers (sources, live sessions).
 */
const everythingSurfaced = async (): Promise<string> =>
  JSON.stringify([
    logs.lines,
    platform.db.$client.query('SELECT error, payload FROM jobs').all(),
    platform.db.$client.query('SELECT kind, context FROM notifications').all(),
    platform.db.$client.query('SELECT upstream FROM tv_channels').all(),
    adminTvSourcesResponseSchema.parse(await (await request('GET', '/admin/tv/sources')).json()),
    await (await request('GET', '/admin/tv/sessions')).json(),
  ])

describe('an Xtream Codes source (§29.2) on SQLite against a replayed panel', () => {
  test('reads the account, its categories and live streams; credentials never returned', async () => {
    const id = await createSource()
    expect(await runJobs(['refresh_tv_source', 'fetch_tv_logos', 'refresh_tv_guide'])).toEqual([
      'refresh_tv_source done',
      'fetch_tv_logos done',
      'refresh_tv_guide done',
    ])
    const source = await detail(id)
    expect(source).toMatchObject({
      kind: 'xtream',
      settings: { kind: 'xtream', serverUrl: iptv.url },
      state: 'ready',
      maxConnections: 2,
      channelCount: 4,
      enabledChannelCount: 0,
    })
    expect(source.settings).toEqual({ kind: 'xtream', serverUrl: iptv.url })
    expect(source.groups.map((g) => [g.name, g.channelCount])).toEqual([
      ['Sports', 1],
      ['News', 2],
      ['', 1],
    ])
    expectNoCredentials(JSON.stringify(source))
  })

  test('the account sets the connection limit at each refresh; the admin cannot', async () => {
    const id = await createSource()
    await runJobs(['refresh_tv_source'])
    expect((await detail(id)).maxConnections).toBe(2)

    const patched = await request('PATCH', `/admin/tv/sources/${id}`, { maxConnections: 5 })
    expect(patched.status).toBe(422)
    expect(await patched.json()).toMatchObject({ error: { code: 'tv/source_invalid' } })
    const created = await request('POST', '/admin/tv/sources', {
      name: 'Limited',
      settings: xtreamSettings(),
      maxConnections: 1,
    })
    expect(created.status).toBe(422)
    expect(await created.json()).toMatchObject({ error: { code: 'tv/source_invalid' } })
    const listed = adminTvSourcesResponseSchema.parse(
      await (await request('GET', '/admin/tv/sources')).json(),
    )
    expect(listed.items.map((source) => source.id)).toEqual([id])

    iptv.setXtreamAccount({ max_connections: '0' })
    await request('POST', `/admin/tv/sources/${id}/refresh`)
    await runJobs(['refresh_tv_source'])
    expect(await detail(id)).not.toHaveProperty('maxConnections')
  })

  test('a PATCH keeps the credentials it does not name; a new password refreshes', async () => {
    const id = await createSource('wrong-pass')
    expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source tv/account_refused'])
    expect(await detail(id)).toMatchObject({
      state: 'error',
      lastError: { code: 'tv/account_refused' },
    })

    const renamed = await request('PATCH', `/admin/tv/sources/${id}`, {
      name: 'Renamed',
      settings: { kind: 'xtream' },
    })
    expect(renamed.status).toBe(200)
    expect(await runJobs(['refresh_tv_source'])).toEqual([])
    const emptied = await request('PATCH', `/admin/tv/sources/${id}`, {
      settings: { kind: 'xtream', password: '' },
    })
    expect(emptied.status).toBe(400)

    const fixed = await request('PATCH', `/admin/tv/sources/${id}`, {
      settings: { kind: 'xtream', password: xtreamCredentials.password },
    })
    expect(await fixed.json()).toMatchObject({ state: 'refreshing', name: 'Renamed' })
    expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source done'])
    expect(await detail(id)).toMatchObject({ state: 'ready', channelCount: 4 })
  })

  test('a refused account fails three times into a notification, never with a credential', async () => {
    const id = await createSource()
    await runJobs(['refresh_tv_source'])
    iptv.setXtreamAccount({ status: 'Expired' })
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request('POST', `/admin/tv/sources/${id}/refresh`)
      expect(await runJobs(['refresh_tv_source'])).toEqual(['refresh_tv_source tv/account_refused'])
    }
    expect(await detail(id)).toMatchObject({
      state: 'error',
      failureCount: 3,
      channelCount: 4,
      lastError: { code: 'tv/account_refused' },
    })
    const notified = platform.db.$client
      .query("SELECT context FROM notifications WHERE kind = 'tv/source_unreachable'")
      .all() as { context: string }[]
    expect(notified).toHaveLength(1)
    expect(JSON.parse(notified[0]?.context ?? '{}')).toMatchObject({ code: 'tv/account_refused' })
    expect(
      logs.lines.find((line) => line.message === 'tv source refresh failed')?.fields,
    ).toMatchObject({ code: 'tv/account_refused', reason: 'expired' })
    expectNoCredentials(await everythingSurfaced())
  })

  test("the guide comes from the account's xmltv.php: now and next", async () => {
    const id = await createSource()
    await runJobs(['refresh_tv_source'])
    await enableAll(id)
    expect(await runJobs(['refresh_tv_guide'])).toEqual(['refresh_tv_guide done'])
    const listed = await channels()
    const idOf = (name: string) => listed.items.find((item) => item.name === name)?.id
    const guide = tvGuideResponseSchema.parse(
      await (await request('GET', '/tv/guide', undefined, 'user')).json(),
    )
    const entry = (name: string) => guide.items.find((item) => item.channelId === idOf(name))
    // `news.one` by its epg_channel_id; Sport One without one, by its name (§29.3).
    expect(entry('News One')).toMatchObject({
      now: { title: 'Xtream news' },
      next: { title: 'Xtream weather' },
    })
    expect(entry('Sport One')).toMatchObject({ now: { title: 'Xtream match' } })
    expect(entry('News Two')).toBeUndefined()
    expect(iptv.requests.filter((r) => r.path.startsWith('/xmltv.php')).map((r) => r.path)).toEqual(
      [`/xmltv.php?username=projo-user&password=${encodeURIComponent('s3cret/pass')}`],
    )
  })
})

describe.skipIf(!hasFfmpeg())(
  'an Xtream channel through the relay (§29.4) with real ffmpeg',
  () => {
    test('plays through the capability URL from /live/<user>/<pass>/<id>.ts', async () => {
      const id = await createSource()
      await runJobs(['refresh_tv_source'])
      await enableAll(id)
      const channel = (await channels()).items.find((item) => item.name === 'News One')
      if (channel === undefined) throw new Error('no channel')

      const response = await request(
        'POST',
        `/tv/channels/${channel.id}/sessions`,
        { capabilities },
        'user',
      )
      expect(response.status).toBe(201)
      const session = tvSessionDtoSchema.parse(await response.json())
      expectNoCredentials(JSON.stringify(session))
      const playlist = await t.request(session.streamUrl)
      expect(playlist.status).toBe(200)
      expect(await playlist.text()).toContain('#EXT-X-MAP:URI="init-1.mp4"')
      expect(iptv.liveRequests().map((r) => r.path)).toContain(
        `/live/projo-user/${encodeURIComponent('s3cret/pass')}/101.ts`,
      )
      const surfaced = await everythingSurfaced()
      expect(surfaced).toContain(session.sessionId)
      expectNoCredentials(surfaced)
      await request('DELETE', `/tv/sessions/${session.sessionId}`, undefined, 'user')
    }, 60_000)

    test("a stream the panel refuses is unavailable; ffmpeg's errors are logged without credentials", async () => {
      const id = await createSource()
      await runJobs(['refresh_tv_source'])
      await enableAll(id)
      const channel = (await channels()).items.find((item) => item.name === 'News Two')
      if (channel === undefined) throw new Error('no channel')
      // The panel's password changed since the refresh: the stream URL is refused (401).
      const changed = 'changed-pass'
      platform.db.$client
        .query('UPDATE tv_sources SET settings = ? WHERE id = ?')
        .run(JSON.stringify({ ...xtreamSettings(changed) }), id)

      const response = await request(
        'POST',
        `/tv/channels/${channel.id}/sessions`,
        { capabilities },
        'user',
      )
      expect(response.status).toBe(502)
      expect(await response.json()).toMatchObject({ error: { code: 'tv/stream_unavailable' } })
      expect(iptv.liveRequests().length).toBeGreaterThan(0)
      // ffprobe quotes the URL with its credentials: masked to the host (§29.4).
      const probeFailure = logs.lines.find((line) => line.message === 'live stream probe failed')
      expect(JSON.stringify(probeFailure?.fields)).toContain('/… Server returned 401')
      expectNoCredentials(await everythingSurfaced(), changed)
    }, 60_000)
  },
)
