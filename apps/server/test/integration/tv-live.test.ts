import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ClientCapabilities } from '@projo/shared/api/playback'
import {
  adminTvSessionsResponseSchema,
  type AdminTvSourceDetailDto,
  adminTvSourceDetailDtoSchema,
  tvChannelsResponseSchema,
  type TvSessionDto,
  tvSessionDtoSchema,
} from '@projo/shared/api/tv'

import { transcodeSlotsFactory } from '../../src/application/playback/transcode-slots.ts'
import { dataPathsFor } from '../../src/core/data-paths.ts'
import { defaultLiveLimits, type LiveLimits } from '../../src/core/tv/live.ts'
import type { JobType } from '../../src/core/jobs/job.ts'
import type { JobHandler } from '../../src/entrypoints/jobs/handler.ts'
import { buildTvModule } from '../../src/entrypoints/modules/tv.ts'
import type { Platform } from '../../src/entrypoints/modules/platform.ts'
import { ensureDataLayout } from '../../src/infrastructure/fs/data-layout.ts'
import { DEFAULT_METADATA_LANGUAGE } from '../../src/infrastructure/sqlite/metadata-settings-repository.ts'
import { createSqlitePlaybackSessionRepository } from '../../src/infrastructure/sqlite/playback-session-repository.ts'
import {
  createSqlitePlaybackSettings,
  createSqlitePlaybackSettingsWriter,
} from '../../src/infrastructure/sqlite/playback-settings.ts'
import { createAuthTestApp, sessionCookieOf } from '../support/auth-app.ts'
import { createTempDir } from '../support/database.ts'
import { type IptvServer, startIptvServer } from '../support/iptv-server.ts'
import { createCapturingLogger, silentLogger } from '../support/logger.ts'
import { hasFfmpeg, hasFfmpegEncoder } from '../support/media.ts'

/**
 * The relay of §29.4 with real ffmpeg against the test provider's endless MPEG-TS: sessions,
 * sharing, idle stop, restarts, the connection limit and the capability URL.
 */

const capabilities: ClientCapabilities = {
  videoCodecs: ['avc1'],
  audioCodecs: ['mp4a.40.2'],
  hls: 'mse',
}

/** The desktop app: libmpv plays the copy whatever it carries (§29.4). */
const desktop: ClientCapabilities = { ...capabilities, hls: 'native', engine: 'mpv' }

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
let slots: ReturnType<typeof transcodeSlotsFactory>
let logs: ReturnType<typeof createCapturingLogger>
let liveDir: string
let cookies: { admin: string; user: string }
/** The replay window and the cache cap (§29.4): the settings' defaults unless a test says. */
let limits: LiveLimits = defaultLiveLimits

beforeEach(async () => {
  temp = createTempDir()
  const paths = dataPathsFor(temp.path.replaceAll('\\', '/'))
  if (!ensureDataLayout(paths).ok) throw new Error('no data layout')
  liveDir = paths.cache.live
  logs = createCapturingLogger()
  t = createAuthTestApp({
    paths,
    jobs: 'queue',
    routes: (built) => {
      slots = transcodeSlotsFactory({
        sessionRepository: createSqlitePlaybackSessionRepository({ db: built.db }),
        playbackSettings: createSqlitePlaybackSettings({ db: built.db }),
        clock: built.clock,
        logger: logs.logger,
      })
      module = buildTvModule(
        { ...built, logger: logs.logger },
        { transcodeSlots: slots, metadataLanguage: () => DEFAULT_METADATA_LANGUAGE },
        {
          live: {
            timings: { retryDelaysMs: [50, 100, 200], idleStopMs: 300, expiredGraceS: 2 },
            limits: () => limits,
          },
        },
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
  limits = defaultLiveLimits
  await module.stop()
  iptv.restoreLive()
  iptv.requests.length = 0
  temp.cleanup()
})

const request = (method: string, path: string, body?: unknown, as: 'admin' | 'user' = 'admin') =>
  t.as(cookies[as]).send(method, `/api/v1${path}`, body)

/** A request without any credential: what a player sends to a capability URL (§20). */
const anonymous = (path: string, init?: RequestInit) => t.request(path, init)

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

/** A source of `live.m3u` (or `playlist`) with every group enabled; its channels by name. */
const liveSource = async (maxConnections?: number, playlist = 'live.m3u') => {
  const created = await request('POST', '/admin/tv/sources', {
    name: 'Provider',
    settings: { kind: 'm3u', playlistUrl: iptv.at(`/m3u/${playlist}?token=secret`) },
    ...(maxConnections === undefined ? {} : { maxConnections }),
  })
  const { id } = (await created.json()) as { id: string }
  await runJobs(['refresh_tv_source'])
  const detail: AdminTvSourceDetailDto = adminTvSourceDetailDtoSchema.parse(
    await (await request('GET', `/admin/tv/sources/${id}`)).json(),
  )
  for (const group of detail.groups) {
    await request('PATCH', `/admin/tv/sources/${id}/groups/${group.id}`, { enabled: true })
  }
  const listed = tvChannelsResponseSchema.parse(
    await (await request('GET', '/tv/channels', undefined, 'user')).json(),
  )
  const channel = (name: string): string => {
    const found = listed.items.find((item) => item.name === name)
    if (found === undefined) throw new Error(`no channel ${name}`)
    return found.id
  }
  return { id, listed, channel }
}

const openSession = async (
  channelId: string,
  as: 'admin' | 'user' = 'admin',
  client: ClientCapabilities = capabilities,
) => {
  const response = await request(
    'POST',
    `/tv/channels/${channelId}/sessions`,
    { capabilities: client },
    as,
  )
  return { response, body: (await response.json()) as unknown }
}

const startSession = async (
  channelId: string,
  as: 'admin' | 'user' = 'admin',
  client: ClientCapabilities = capabilities,
) => {
  const { response, body } = await openSession(channelId, as, client)
  if (response.status !== 201) throw new Error(`session refused: ${JSON.stringify(body)}`)
  return tvSessionDtoSchema.parse(body)
}

const playlistOf = async (session: TvSessionDto): Promise<string> => {
  const response = await anonymous(session.streamUrl)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('application/vnd.apple.mpegurl')
  return response.text()
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const until = async (
  check: () => boolean | Promise<boolean>,
  ms = 15_000,
  everyMs = 100,
): Promise<void> => {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await sleep(everyMs)
  }
}

const segmentsOf = (playlist: string): string[] =>
  playlist.split('\n').filter((line) => line.endsWith('.m4s'))

const fileUrl = (session: TvSessionDto, name: string) =>
  session.streamUrl.replace(/index\.m3u8$/u, name)

const fetchFile = async (session: TvSessionDto, name: string): Promise<Uint8Array> => {
  const response = await anonymous(fileUrl(session, name))
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toBe('video/mp4')
  return new Uint8Array(await response.arrayBuffer())
}

/** Decodes a run's init and segments joined, as a player would: ffmpeg's errors, if any. */
const decodeRun = async (session: TvSessionDto, run: number, segments: readonly string[]) => {
  const parts = [await fetchFile(session, `init-${run}.mp4`)]
  for (const name of segments) parts.push(await fetchFile(session, name))
  const file = join(temp.path, `run-${run}.mp4`)
  writeFileSync(file, Buffer.concat(parts))
  const decoded = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', file, '-f', 'null', '-'])
  const probed = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', file])
  return {
    exitCode: decoded.exitCode,
    errors: decoded.stderr.toString().trim(),
    codecs: (
      JSON.parse(probed.stdout.toString()) as { streams: { codec_name: string }[] }
    ).streams.map((s) => s.codec_name),
  }
}

/** ffprobe of the playlist's init and newest segment joined: what a player decodes. */
const probeServed = async (session: TvSessionDto) => {
  const playlist = await playlistOf(session)
  const init = /#EXT-X-MAP:URI="([^"]+)"/u.exec(playlist)?.[1] ?? ''
  const segment = segmentsOf(playlist).at(-1) ?? ''
  const parts = await Promise.all(
    [init, segment].map(async (name) => {
      const response = await anonymous(fileUrl(session, name))
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('video/mp4')
      return new Uint8Array(await response.arrayBuffer())
    }),
  )
  const file = join(temp.path, 'served.mp4')
  writeFileSync(file, Buffer.concat(parts))
  const probed = Bun.spawnSync([
    'ffprobe',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    file,
  ])
  return (
    JSON.parse(probed.stdout.toString()) as {
      streams: { codec_type: string; codec_name: string; channels?: number }[]
    }
  ).streams
}

describe.skipIf(!hasFfmpeg())('live TV relay (§29.4) with real ffmpeg', () => {
  test(
    'a session plays a channel through its capability URL, segments keep coming',
    async () => {
      const { channel, listed } = await liveSource()
      expect(listed.groups.map((group) => group.name)).toEqual(['Live', 'Other'])
      expect(listed.items.map((item) => [item.name, item.number])).toEqual([
        ['Live One', 1],
        ['Live MP2', 2],
        ['Live Described', 3],
        ['Live Interlaced', 4],
        ['Live Down', 5],
      ])
      const session = await startSession(channel('Live One'), 'user')
      expect(session.rendition).toBe('copy')
      expect(session.streamUrl).toMatch(
        new RegExp(`^/api/v1/stream/${session.sessionId}/[\\w-]{40,}/live/index\\.m3u8$`, 'u'),
      )

      const first = await playlistOf(session)
      expect(first).toContain('#EXT-X-MAP:URI="init-1.mp4"')
      expect(first).not.toContain('#EXT-X-ENDLIST')
      expect(first).not.toContain('secret')
      expect(first).not.toContain('progressive')
      const streams = await probeServed(session)
      expect(streams.map((s) => [s.codec_type, s.codec_name])).toEqual([
        ['video', 'h264'],
        ['audio', 'aac'],
      ])
      // The window moves: a later playlist lists a newer segment.
      const newest = segmentsOf(first).at(-1)
      await until(async () => segmentsOf(await playlistOf(session)).at(-1) !== newest)

      expect((await anonymous(fileUrl(session, 'seg-9-00000.m4s'))).status).toBe(404)
      expect((await anonymous(fileUrl(session, '..%2Frun-1.m3u8'))).status).toBe(404)
      const wrongSecret = session.streamUrl.replace(/\/[\w-]{40,}\//u, '/not-the-secret/')
      expect((await anonymous(wrongSecret)).status).toBe(404)
      expect((await request('POST', `/tv/sessions/${session.sessionId}/heartbeat`)).status).toBe(
        404,
      )
      expect(
        (await request('POST', `/tv/sessions/${session.sessionId}/heartbeat`, undefined, 'user'))
          .status,
      ).toBe(204)
    },
    timeout,
  )

  test(
    'two viewers share one upstream connection; the stream stops once idle',
    async () => {
      const { channel } = await liveSource()
      const one = await startSession(channel('Live One'))
      const upstreamRequests = iptv.liveRequests().length
      const two = await startSession(channel('Live One'), 'user')
      expect(iptv.liveRequests().length).toBe(upstreamRequests)
      // The probe's connection may still be closing on the provider's side.
      await until(() => iptv.liveConnections() === 1)
      expect(module.liveStreams.snapshot()).toMatchObject([{ viewers: 2, runs: 1 }])
      expect(segmentsOf(await playlistOf(two)).length).toBeGreaterThan(0)

      expect((await request('DELETE', `/tv/sessions/${one.sessionId}`)).status).toBe(204)
      await sleep(600)
      expect(iptv.liveConnections()).toBe(1)
      expect(
        (await request('DELETE', `/tv/sessions/${two.sessionId}`, undefined, 'user')).status,
      ).toBe(204)
      await until(() => iptv.liveConnections() === 0 && module.liveStreams.snapshot().length === 0)
      expect(existsSync(`${liveDir}/${channel('Live One')}`)).toBe(false)
      expect((await anonymous(two.streamUrl)).status).toBe(404)
    },
    timeout,
  )

  test(
    'audio that is not AAC is transcoded to stereo AAC; an audio description is skipped',
    async () => {
      const { channel } = await liveSource()
      const mp2 = await startSession(channel('Live MP2'))
      expect((await probeServed(mp2)).map((s) => [s.codec_type, s.codec_name, s.channels])).toEqual(
        [
          ['video', 'h264', undefined],
          ['audio', 'aac', 2],
        ],
      )
      // The described channel's first track is an AAC audio description (mono, would be
      // copied); the main track (MP2) is relayed, transcoded to stereo AAC.
      const described = await startSession(channel('Live Described'))
      expect(
        (await probeServed(described)).map((s) => [s.codec_type, s.codec_name, s.channels]),
      ).toEqual([
        ['video', 'h264', undefined],
        ['audio', 'aac', 2],
      ])
      const own = iptv.liveRequests().filter((r) => r.path.startsWith('/live/described.ts'))
      expect(own.length).toBeGreaterThan(0)
      expect(own.every((r) => r.userAgent === 'ProviderPlayer/2.0')).toBe(true)
    },
    timeout,
  )

  test(
    'an upstream that fails is tried again three times, then sessions get tv/stream_unavailable',
    async () => {
      const { channel } = await liveSource()
      const refused = await openSession(channel('Live Down'))
      expect(refused.response.status).toBe(502)
      expect(refused.body).toMatchObject({ error: { code: 'tv/stream_unavailable' } })
      expect(iptv.requests.filter((r) => r.path.startsWith('/status/503')).length).toBe(4)
      expect(module.liveStreams.snapshot()).toEqual([])

      const session = await startSession(channel('Live One'))
      iptv.failLive()
      await until(() => module.liveStreams.snapshot()[0]?.failed === true)
      const beat = await request('POST', `/tv/sessions/${session.sessionId}/heartbeat`)
      expect(beat.status).toBe(502)
      expect(await beat.json()).toMatchObject({ error: { code: 'tv/stream_unavailable' } })
      expect((await anonymous(session.streamUrl)).status).toBe(404)
      expect(existsSync(`${liveDir}/${channel('Live One')}`)).toBe(false)
      const logged = JSON.stringify(logs.lines)
      expect(logged).not.toContain('secret')

      // A new session starts the channel afresh once the upstream is back.
      iptv.restoreLive()
      const again = await startSession(channel('Live One'))
      expect(segmentsOf(await playlistOf(again)).length).toBeGreaterThan(0)
    },
    timeout,
  )

  test('timeshift: the window outgrows 30 s with program dates; a segment out of it goes after its grace', async () => {
    limits = { ...defaultLiveLimits, windowS: 34 }
    const { channel } = await liveSource()
    const channelId = channel('Live One')
    const session = await startSession(channelId)
    expect(session.windowS).toBe(34)
    const beat = () => request('POST', `/tv/sessions/${session.sessionId}/heartbeat`)
    const durationOf = (text: string) =>
      [...text.matchAll(/#EXTINF:([\d.]+),/gu)].reduce((sum, m) => sum + Number(m[1]), 0)

    let playlist = ''
    await until(
      async () => {
        await beat()
        playlist = await playlistOf(session)
        return durationOf(playlist) > 30
      },
      50_000,
      1_000,
    )
    expect(playlist).toContain('#EXT-X-START:TIME-OFFSET=-6')
    expect(playlist).toMatch(/#EXT-X-PROGRAM-DATE-TIME:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/u)
    // The relay's clock is the test app's (stopped): the run's segments follow its first.
    const programDate = Date.parse(/#EXT-X-PROGRAM-DATE-TIME:(\S+)/u.exec(playlist)?.[1] ?? '')
    expect(t.clock.now().getTime() - programDate).toBeGreaterThan(0)
    const [first] = segmentsOf(playlist)
    expect(first).toBe('seg-1-00000.m4s')

    // From a segment on (mpv, §29.5); anything but a sequence is refused.
    const from = await (await anonymous(`${session.streamUrl}?from=3`)).text()
    expect(from).toContain('#EXT-X-MEDIA-SEQUENCE:3')
    expect(segmentsOf(from)[0]).toBe('seg-1-00003.m4s')
    expect((await anonymous(`${session.streamUrl}?from=-1`)).status).toBe(400)
    // Gzipped for a player that accepts it.
    const zipped = await anonymous(session.streamUrl, {
      headers: { 'Accept-Encoding': 'gzip, deflate' },
    })
    expect(zipped.headers.get('content-encoding')).toBe('gzip')
    expect(zipped.headers.get('vary')).toContain('Accept-Encoding')
    expect(
      new TextDecoder().decode(Bun.gunzipSync(new Uint8Array(await zipped.arrayBuffer()))),
    ).toStartWith('#EXTM3U')

    // Out of the window, then deleted once its grace (2 s here) is over on the relay's clock
    // (the test app's, moved by hand).
    const path = `${liveDir}/${channelId}/${first}`
    await until(
      async () => {
        await beat()
        return !segmentsOf(await playlistOf(session)).includes(first ?? '')
      },
      20_000,
      500,
    )
    expect(existsSync(path)).toBe(true)
    await until(
      () => {
        t.clock.advance(1_000)
        return !existsSync(path)
      },
      15_000,
      500,
    )
    expect((await anonymous(fileUrl(session, first ?? ''))).status).toBe(404)
    expect(existsSync(`${liveDir}/${channelId}/init-1.mp4`)).toBe(true)
  }, 90_000)

  test(
    'an upstream cut that comes back within the retries: a new run after a discontinuity',
    async () => {
      const { channel } = await liveSource()
      const session = await startSession(channel('Live One'))
      const before = await playlistOf(session)
      const target = /#EXT-X-TARGETDURATION:\d+/u.exec(before)?.[0]
      expect(target).toBeDefined()

      iptv.failLive()
      const ended = () =>
        logs.lines.filter((line) => line.message === 'live stream run ended').length
      await until(() => ended() >= 1, 15_000, 10)
      iptv.restoreLive()

      let after = ''
      await until(async () => {
        after = await playlistOf(session)
        return /seg-[2-4]-\d+\.m4s/u.test(after)
      })
      expect(module.liveStreams.snapshot()).toMatchObject([{ failed: false }])
      expect(after.split('\n')).toContain('#EXT-X-DISCONTINUITY')
      expect(after).toContain(target ?? '')
      // Timeshift (§29.4): the first run's segments stay in the window, dated, and served.
      const earlier = segmentsOf(after).filter((name) => name.startsWith('seg-1-'))
      expect(earlier.length).toBeGreaterThan(0)
      expect(after).toContain('#EXT-X-MAP:URI="init-1.mp4"')
      const dates = [...after.matchAll(/#EXT-X-PROGRAM-DATE-TIME:(\S+)/gu)].map((m) =>
        Date.parse(m[1] ?? ''),
      )
      expect(dates.length).toBeGreaterThanOrEqual(2)
      expect(dates).toEqual([...dates].sort((a, b) => a - b))
      const replayed = await decodeRun(session, 1, earlier)
      expect(replayed).toEqual({ exitCode: 0, errors: '', codecs: ['h264', 'aac'] })
      const run = Math.max(...[...after.matchAll(/init-(\d+)\.mp4/gu)].map((m) => Number(m[1])))
      expect(run).toBeGreaterThan(1)
      const own = segmentsOf(after).filter((name) => name.startsWith(`seg-${run}-`))
      expect(own.length).toBeGreaterThan(0)
      const decoded = await decodeRun(session, run, own)
      expect(decoded).toEqual({ exitCode: 0, errors: '', codecs: ['h264', 'aac'] })
      // The session went on without a new request.
      expect((await request('POST', `/tv/sessions/${session.sessionId}/heartbeat`)).status).toBe(
        204,
      )
    },
    timeout,
  )

  test(
    'a client that gives up while its channel starts frees the connection for the next one',
    async () => {
      const { channel } = await liveSource(1)
      const zapping = new AbortController()
      const abandoned = t.request(`/api/v1/tv/channels/${channel('Live One')}/sessions`, {
        method: 'POST',
        headers: {
          cookie: cookies.admin,
          origin: 'http://localhost',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ capabilities }),
        signal: zapping.signal,
      })
      await until(() => iptv.liveRequests().length > 0, 15_000, 20)
      zapping.abort()
      expect((await abandoned).status).toBe(502)
      expect(module.liveStreams.snapshot()).toMatchObject([{ viewers: 0 }])

      const next = await startSession(channel('Live MP2'))
      expect(segmentsOf(await playlistOf(next)).length).toBeGreaterThan(0)
      await until(() => iptv.liveConnections() === 1)
      expect(module.liveStreams.snapshot().map((s) => s.channelId)).toEqual([channel('Live MP2')])
    },
    timeout,
  )

  test(
    'the connection limit stops an idle stream first, else refuses the session',
    async () => {
      const { channel } = await liveSource(1)
      const one = await startSession(channel('Live One'))
      const refused = await openSession(channel('Live MP2'))
      expect(refused.response.status).toBe(503)
      expect(refused.body).toMatchObject({ error: { code: 'tv/connection_limit_reached' } })

      await request('DELETE', `/tv/sessions/${one.sessionId}`)
      const two = await startSession(channel('Live MP2'))
      await until(() => iptv.liveConnections() === 1)
      expect(module.liveStreams.snapshot().map((s) => s.channelId)).toEqual([channel('Live MP2')])
      expect(segmentsOf(await playlistOf(two)).length).toBeGreaterThan(0)
    },
    timeout,
  )

  test(
    'the admin lists live sessions and stops one; its player is told',
    async () => {
      const { channel } = await liveSource()
      const session = await startSession(channel('Live One'), 'user')
      const listed = adminTvSessionsResponseSchema.parse(
        await (await request('GET', '/admin/tv/sessions')).json(),
      )
      expect(listed.items).toMatchObject([
        {
          id: session.sessionId,
          account: { name: 'zoe' },
          profile: { name: 'zoe' },
          channel: { name: 'Live One', number: 1 },
          rendition: 'copy',
        },
      ])
      expect((await request('GET', '/admin/tv/sessions', undefined, 'user')).status).toBe(403)

      expect((await request('DELETE', `/admin/tv/sessions/${session.sessionId}`)).status).toBe(204)
      expect(t.events).toContainEqual({
        type: 'playback.session_terminated',
        payload: expect.objectContaining({ playbackSessionId: session.sessionId, reason: 'admin' }),
      })
      const beat = await request(
        'POST',
        `/tv/sessions/${session.sessionId}/heartbeat`,
        undefined,
        'user',
      )
      expect(beat.status).toBe(404)
      expect(await beat.json()).toMatchObject({ error: { code: 'tv/session_not_found' } })
      expect((await request('DELETE', `/admin/tv/sessions/${session.sessionId}`)).status).toBe(404)
    },
    timeout,
  )

  test(
    "turning a profile's Live TV off ends its live sessions at once (§29.6)",
    async () => {
      const { channel } = await liveSource()
      const session = await startSession(channel('Live One'), 'user')
      const mine = await startSession(channel('Live One'))
      const off = await request('PATCH', '/profiles/profile-zoe', { liveTv: false })
      expect(off.status).toBe(200)
      expect(t.events).toContainEqual({
        type: 'playback.session_terminated',
        payload: expect.objectContaining({ playbackSessionId: session.sessionId, reason: 'ended' }),
      })
      const listed = adminTvSessionsResponseSchema.parse(
        await (await request('GET', '/admin/tv/sessions')).json(),
      )
      // Its capability URL is refused at once (§20).
      expect((await anonymous(session.streamUrl)).status).toBe(404)
      expect(listed.items.map((item) => item.id)).toEqual([mine.sessionId])
      const refused = await openSession(channel('Live One'), 'user')
      expect(refused.response.status).toBe(404)
      expect(refused.body).toMatchObject({ error: { code: 'tv/channel_not_found' } })
      await endSession(mine)
    },
    timeout,
  )
})

/** ffprobe of the served init and newest segment: the video's codec, field order and height. */
const probeCompat = async (session: TvSessionDto) => {
  const playlist = await playlistOf(session)
  const init = /#EXT-X-MAP:URI="([^"]+)"/u.exec(playlist)?.[1] ?? ''
  const segment = segmentsOf(playlist).at(-1) ?? ''
  const file = join(temp.path, 'compat.mp4')
  writeFileSync(
    file,
    Buffer.concat([await fetchFile(session, init), await fetchFile(session, segment)]),
  )
  const probed = Bun.spawnSync([
    'ffprobe',
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_frames',
    '-read_intervals',
    '%+#10',
    file,
  ])
  const { streams, frames } = JSON.parse(probed.stdout.toString()) as {
    streams: { codec_type: string; codec_name: string; height?: number; field_order?: string }[]
    frames: { media_type: string; interlaced_frame?: number }[]
  }
  return {
    streams: streams.map((s) => [s.codec_type, s.codec_name]),
    video: streams.find((s) => s.codec_type === 'video'),
    interlacedFrames: frames.filter((f) => f.media_type === 'video' && f.interlaced_frame === 1)
      .length,
    videoFrames: frames.filter((f) => f.media_type === 'video').length,
  }
}

const endSession = async (session: TvSessionDto, as: 'admin' | 'user' = 'admin') => {
  expect((await request('DELETE', `/tv/sessions/${session.sessionId}`, undefined, as)).status).toBe(
    204,
  )
}

describe.skipIf(!hasFfmpeg())('compat rendition (§29.4) with real ffmpeg', () => {
  test(
    'an interlaced channel reaches a browser as progressive H.264; mpv shares its upstream',
    async () => {
      const { channel } = await liveSource(undefined, 'compat.m3u')
      const interlaced = channel('Compat Interlaced')
      const copy = await startSession(interlaced, 'admin', desktop)
      expect(copy.rendition).toBe('copy')
      const compat = await startSession(interlaced, 'user')
      expect(compat.rendition).toBe('compat')
      expect(compat.streamUrl).toMatch(/\/live\/index\.m3u8$/u)
      expect(slots.held()).toBe(1)

      const served = await probeCompat(compat)
      expect(served.streams).toEqual([
        ['video', 'h264'],
        ['audio', 'aac'],
      ])
      expect(served.video?.field_order).toBe('progressive')
      expect(served.video?.height).toBeLessThanOrEqual(1080)
      expect(served.videoFrames).toBeGreaterThan(0)
      expect(served.interlacedFrames).toBe(0)
      // The copy still carries the interlaced picture, for libmpv.
      expect((await probeCompat(copy)).interlacedFrames).toBeGreaterThan(0)

      // One upstream connection for both renditions.
      await until(() => iptv.liveConnections() === 1)
      expect(iptv.liveRequests().filter((r) => r.path.startsWith('/live/interlaced'))).toHaveLength(
        // The probe's request, then the copy run's.
        2,
      )
      expect(module.liveStreams.snapshot()).toMatchObject([
        { rendition: 'copy', viewers: 2 },
        { rendition: 'compat', viewers: 1 },
      ])
      const admin = adminTvSessionsResponseSchema.parse(
        await (await request('GET', '/admin/tv/sessions')).json(),
      )
      expect(admin.items.map((item) => item.rendition).sort()).toEqual(['compat', 'copy'])
      expect(existsSync(`${liveDir}/${interlaced}-compat`)).toBe(true)

      await endSession(compat, 'user')
      await endSession(copy)
      await until(() => module.liveStreams.snapshot().length === 0 && slots.held() === 0)
      await until(() => iptv.liveConnections() === 0)
      expect(existsSync(`${liveDir}/${interlaced}-compat`)).toBe(false)
      expect(existsSync(`${liveDir}/${interlaced}`)).toBe(false)
    },
    timeout,
  )

  test.skipIf(!hasFfmpegEncoder('libx265'))(
    'an HEVC channel reaches a browser without HEVC as H.264 and AAC',
    async () => {
      const { channel } = await liveSource(undefined, 'compat.m3u')
      const session = await startSession(channel('Compat HEVC'), 'user')
      expect(session.rendition).toBe('compat')
      const served = await probeCompat(session)
      expect(served.streams).toEqual([
        ['video', 'h264'],
        ['audio', 'aac'],
      ])
      expect(served.video?.height).toBeLessThanOrEqual(1080)
      // A client that decodes HEVC gets the copy.
      const hevc = await startSession(channel('Compat HEVC'), 'admin', {
        ...capabilities,
        videoCodecs: ['avc1', 'hvc1'],
      })
      expect(hevc.rendition).toBe('copy')
      expect((await probeServed(hevc)).map((s) => s.codec_name)).toEqual(['hevc', 'aac'])
      await until(() => iptv.liveConnections() === 1)
    },
    timeout,
  )

  test(
    'no transcode slot free: the session is refused before the provider is reached',
    async () => {
      const { channel } = await liveSource(undefined, 'compat.m3u')
      const interlaced = channel('Compat Interlaced')
      // Probed by a first (copy) session, so the next browser session knows it needs compat.
      const copy = await startSession(interlaced, 'admin', desktop)
      await endSession(copy)
      await until(() => module.liveStreams.snapshot().length === 0)
      createSqlitePlaybackSettingsWriter({ db: platform.db }).write({
        values: { maxConcurrentTranscodes: 0 },
        at: t.clock.now(),
      })
      const before = iptv.liveRequests().length
      const refused = await openSession(interlaced, 'user')
      expect(refused.response.status).toBe(503)
      expect(refused.body).toMatchObject({ error: { code: 'playback/transcode_limit_reached' } })
      expect(iptv.liveRequests().length).toBe(before)
      expect(module.liveStreams.snapshot()).toEqual([])
    },
    timeout,
  )
})

describe('live sessions without a stream', () => {
  test('a disabled or unknown channel has no session', async () => {
    const created = await request('POST', '/admin/tv/sources', {
      name: 'Provider',
      settings: { kind: 'm3u', playlistUrl: iptv.at('/m3u/live.m3u') },
    })
    expect(created.status).toBe(201)
    await runJobs(['refresh_tv_source'])
    const listed = tvChannelsResponseSchema.parse(
      await (await request('GET', '/tv/channels', undefined, 'user')).json(),
    )
    expect(listed).toEqual({ groups: [], items: [], favorites: [] })
    const unknown = await openSession('nope')
    expect(unknown.response.status).toBe(404)
    expect(unknown.body).toMatchObject({ error: { code: 'tv/channel_not_found' } })
    expect(iptv.liveRequests()).toEqual([])
  })
})
