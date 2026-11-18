import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'

import type { ClientCapabilities } from '@projo/shared/api/playback'
import {
  type AdminTvSourceDetailDto,
  adminTvSourceDetailDtoSchema,
  adminTvSourceDtoSchema,
  tvChannelsResponseSchema,
  tvGuideResponseSchema,
} from '@projo/shared/api/tv'

import { transcodeSlotsFactory } from '../../src/application/playback/transcode-slots.ts'
import { type DataPaths, dataPathsFor } from '../../src/core/data-paths.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { buildTvModule } from '../../src/entrypoints/modules/tv.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { DEFAULT_METADATA_LANGUAGE } from '../../src/infrastructure/sqlite/metadata-settings-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../src/infrastructure/sqlite/playback-session-repository.ts'
import { createSqlitePlaybackSettings } from '../../src/infrastructure/sqlite/playback-settings.ts'
import { createAuthTestApp, sessionCookieOf } from '../support/auth-app.ts'
import { createTempDir } from '../support/database.ts'
import { type IptvServer, startIptvServer, xtreamCredentials } from '../support/iptv-server.ts'
import { createCapturingLogger, silentLogger } from '../support/logger.ts'
import { hasFfmpeg } from '../support/media.ts'

/**
 * Channel snapshots (§29.4) with real ffmpeg against the test provider's endless MPEG-TS: from a
 * running stream, from a background grab, a refused grab's logs, and the snapshot route.
 */

const capabilities: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}

const timeout = 60_000

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
let paths: DataPaths
let cookies: { admin: string; user: string }

beforeEach(async () => {
  temp = createTempDir()
  paths = dataPathsFor(temp.path.replaceAll('\\', '/'))
  if (!ensureDataLayout(paths).ok) throw new Error('no data layout')
  logs = createCapturingLogger()
  t = createAuthTestApp({
    paths,
    jobs: 'queue',
    routes: (built) => {
      const slots = transcodeSlotsFactory({
        sessionRepository: createSqlitePlaybackSessionRepository({ db: built.db }),
        playbackSettings: createSqlitePlaybackSettings({ db: built.db }),
        clock: built.clock,
        logger: logs.logger,
      })
      module = buildTvModule(
        { ...built, logger: logs.logger },
        { transcodeSlots: slots, metadataLanguage: () => DEFAULT_METADATA_LANGUAGE },
        { live: { timings: { idleStopMs: 300 }, random: () => 0 } },
      )
      return { tv: module.routes, adminTv: module.adminRoutes }
    },
  })
  platform = t.platform
  const { cookie } = await t.completeSetup()
  const zoe = await t.addUser()
  cookies = { admin: cookie, user: sessionCookieOf(await t.login('zoe', zoe.password)) }
})
afterEach(async () => {
  await module.stop()
  iptv.requests.length = 0
  temp.cleanup()
})

const request = (method: string, path: string, body?: unknown, as: 'admin' | 'user' = 'admin') =>
  t.as(cookies[as]).send(method, `/api/v1${path}`, body)

const runJobs = async (types: readonly JobType[]) => {
  const handlers: Partial<Record<JobType, JobHandler>> = module.jobHandlers
  for (;;) {
    const job = platform.jobRepository.claimNext({ types, now: t.clock.now() })
    if (job === undefined) return
    const handler = handlers[job.type]
    if (handler === undefined) throw new Error(`no handler for ${job.type}`)
    await handler.run(job.payload, {
      job,
      signal: new AbortController().signal,
      reportProgress: () => {},
      logger: silentLogger,
    })
    platform.jobRepository.complete({ id: job.id, finishedAt: t.clock.now() })
  }
}

/** A source with every group enabled; its channels' ids by name. */
const sourceOf = async (settings: Record<string, unknown>) => {
  const created = await request('POST', '/admin/tv/sources', { name: 'Provider', settings })
  expect(created.status).toBe(201)
  const { id } = (await created.json()) as { id: string }
  await runJobs(['refresh_tv_source'])
  const detail: AdminTvSourceDetailDto = adminTvSourceDetailDtoSchema.parse(
    await (await request('GET', `/admin/tv/sources/${id}`)).json(),
  )
  for (const group of detail.groups)
    await request('PATCH', `/admin/tv/sources/${id}/groups/${group.id}`, { enabled: true })
  const listed = tvChannelsResponseSchema.parse(
    await (await request('GET', '/tv/channels', undefined, 'user')).json(),
  )
  const channel = (name: string): string => {
    const found = listed.items.find((item) => item.name === name)
    if (found === undefined) throw new Error(`no channel ${name}`)
    return found.id
  }
  return { id, channel, detail }
}

const m3uSource = (playlist: string) =>
  sourceOf({ kind: 'm3u', playlistUrl: iptv.at(`/m3u/${playlist}?token=playlist-secret`) })

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const until = async (check: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> => {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await sleep(100)
  }
}

const snapshotFile = (channelId: string) => `${paths.images.dir}/tv/snapshots/${channelId}.webp`

/** The picture's width and height, read by ffprobe. */
const sizeOf = (file: string): { width: number; height: number } => {
  const probed = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', file])
  const [stream] = (
    JSON.parse(probed.stdout.toString()) as { streams: { width: number; height: number }[] }
  ).streams
  if (stream === undefined) throw new Error('no picture')
  return { width: stream.width, height: stream.height }
}

/** Starts the next grab: the spacing since the source's last connection has passed. */
const grabNext = async () => {
  t.clock.advance(20_000)
  module.snapshotGrabs.tick()
  await module.snapshotGrabs.idle()
}

describe.skipIf(!hasFfmpeg())('channel snapshots (§29.4) with real ffmpeg', () => {
  test(
    'a running stream gives a 480 px WebP, listed and served to the profile, as its logo',
    async () => {
      const { channel } = await m3uSource('live.m3u')
      const one = channel('Live One')
      const created = await request(
        'POST',
        `/tv/channels/${one}/sessions`,
        { capabilities },
        'user',
      )
      expect(created.status).toBe(201)
      await until(() => existsSync(snapshotFile(one)))
      await module.streamSnapshots.idle()
      expect(sizeOf(snapshotFile(one))).toEqual({ width: 480, height: 270 })
      // No provider connection of its own: the stream's probe and run only.
      expect(
        iptv.liveRequests().filter((r) => r.path.startsWith('/live/progressive')),
      ).toHaveLength(2)

      const guide = tvGuideResponseSchema.parse(
        await (await request('GET', '/tv/guide', undefined, 'user')).json(),
      )
      const entry = guide.items.find((item) => item.channelId === one)
      expect(entry?.snapshot?.url).toMatch(
        new RegExp(`^/api/v1/tv/channels/${one}/snapshot\\?v=\\d+$`, 'u'),
      )
      const listed = tvChannelsResponseSchema.parse(
        await (await request('GET', '/tv/channels', undefined, 'user')).json(),
      )
      expect(listed.items.find((item) => item.id === one)?.snapshot).toEqual(entry?.snapshot)

      const served = await t.as(cookies.user).send('GET', entry?.snapshot?.url ?? '')
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toBe('image/webp')
      expect(served.headers.get('cache-control')).toBe('private, max-age=86400')
      const bytes = new Uint8Array(await served.arrayBuffer())
      expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WEBP')

      // A channel disabled: gone for viewers, still served to an admin (§29.7).
      await request('PATCH', `/admin/tv/channels/${one}`, { enabled: false })
      const refused = await request('GET', `/tv/channels/${one}/snapshot`, undefined, 'user')
      expect(refused.status).toBe(404)
      expect(await refused.json()).toMatchObject({ error: { code: 'tv/channel_not_found' } })
      expect((await request('GET', `/tv/channels/${one}/snapshot`)).status).toBe(200)
      // A channel without a snapshot has none to serve.
      const other = await request('GET', `/tv/channels/${channel('Live MP2')}/snapshot`)
      expect(other.status).toBe(404)
    },
    timeout,
  )

  test(
    'a background grab reads one keyframe of the upstream, then lets its connection go',
    async () => {
      const { channel } = await m3uSource('snapshots.m3u')
      // The first channel in the page's order is refused (an HTTP 403): a refusal, logged.
      module.snapshotGrabs.tick()
      await module.snapshotGrabs.idle()
      const refused = channel('Snap Refused')
      expect(existsSync(snapshotFile(refused))).toBe(false)
      expect(
        logs.lines.find((line) => line.message === 'tv snapshot grab failed')?.fields,
      ).toMatchObject({ channelId: refused, reason: 'refused' })

      await grabNext()
      const one = channel('Snap One')
      expect(existsSync(snapshotFile(one))).toBe(true)
      expect(sizeOf(snapshotFile(one))).toEqual({ width: 480, height: 270 })
      await grabNext()
      const interlaced = channel('Snap Interlaced')
      expect(existsSync(snapshotFile(interlaced))).toBe(true)
      // One connection per grab.
      expect(iptv.liveRequests().map((r) => r.path.split('?')[0])).toEqual([
        '/live/progressive.ts',
        '/live/interlaced.ts',
      ])

      // Neither the playlist's nor a stream's secret, nor a path, in any log line.
      const logged = JSON.stringify(logs.lines)
      expect(logged).not.toContain('snap-secret-token')
      expect(logged).not.toContain('playlist-secret')
      expect(logged).not.toContain('/status/403')
      expect(logged).not.toContain('/live/')

      // The source's setting: on by default (no limit), off on request.
      const sources = (await (await request('GET', '/admin/tv/sources')).json()) as {
        items: unknown[]
      }
      expect(adminTvSourceDtoSchema.parse(sources.items[0])).toMatchObject({
        snapshots: true,
        snapshotGrabsPerHour: 60,
      })
    },
    timeout,
  )

  test(
    "a refused Xtream grab logs the host and a reason, never the account's credentials",
    async () => {
      const { id } = await sourceOf({
        kind: 'xtream',
        serverUrl: `${iptv.url}/`,
        username: xtreamCredentials.username,
        password: xtreamCredentials.password,
      })
      const patched = await request('PATCH', `/admin/tv/sources/${id}`, {
        settings: { kind: 'xtream', password: 'wrong-Passw0rd' },
        snapshotGrabsPerHour: 30,
      })
      expect(patched.status).toBe(200)
      expect(adminTvSourceDtoSchema.parse(await patched.json())).toMatchObject({
        snapshots: true,
        snapshotGrabsPerHour: 30,
      })
      module.snapshotGrabs.tick()
      await module.snapshotGrabs.idle()
      const failed = logs.lines.find((line) => line.message === 'tv snapshot grab failed')
      expect(failed?.fields).toMatchObject({ reason: 'failed', upstream: iptv.url })
      const logged = JSON.stringify(logs.lines)
      for (const secret of [
        xtreamCredentials.username,
        xtreamCredentials.password,
        encodeURIComponent(xtreamCredentials.password),
        'wrong-Passw0rd',
      ])
        expect(logged).not.toContain(secret)

      // Off: no grab at all.
      await request('PATCH', `/admin/tv/sources/${id}`, { snapshots: false })
      const before = iptv.liveRequests().length
      await grabNext()
      expect(iptv.liveRequests()).toHaveLength(before)
    },
    timeout,
  )

  test(
    "a TV page's hint puts what it shows first (§29.4)",
    async () => {
      const { channel } = await m3uSource('snapshots.m3u')
      const interlaced = channel('Snap Interlaced')
      const tooMany = Array.from({ length: 201 }, (_, index) => `c${index}`)
      expect(
        (await request('POST', '/tv/visible-channels', { channelIds: tooMany }, 'user')).status,
      ).toBe(400)
      const hinted = await request(
        'POST',
        '/tv/visible-channels',
        { channelIds: [interlaced] },
        'user',
      )
      expect(hinted.status).toBe(204)
      module.snapshotGrabs.tick()
      await module.snapshotGrabs.idle()
      expect(existsSync(snapshotFile(interlaced))).toBe(true)
      expect(iptv.liveRequests().map((r) => r.path.split('?')[0])).toEqual(['/live/interlaced.ts'])
    },
    timeout,
  )
})
