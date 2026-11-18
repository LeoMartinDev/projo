import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import type { TvGuideProgramme } from '../../../core/tv/guide.ts'
import {
  type IptvServer,
  startIptvServer,
  xtreamCredentials,
} from '../../../../test/support/iptv-server.ts'
import type { Fetch } from './xtream-api.ts'
import { createXtreamProvider } from './xtream-provider.ts'

/** A `null` as panels send it (the code itself never writes one, §5.3). */
const jsonNull: unknown = JSON.parse('null')

const now = new Date('2026-11-18T13:02:00Z')

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
  iptv.setGuideNow(() => now)
})
afterAll(() => iptv.stop())
afterEach(() => {
  iptv.restore('/player_api.php')
  iptv.restore('/xmltv.php')
  iptv.setXtreamAccount({})
  iptv.requests.length = 0
})

const provider = createXtreamProvider({ now: () => now })

const settings = (overrides: { username?: string; password?: string } = {}) => ({
  kind: 'xtream' as const,
  serverUrl: `${iptv.url}/`,
  ...xtreamCredentials,
  ...overrides,
})

/** Neither credential appears in `value` once serialized (raw or percent-encoded). */
const expectNoCredentials = (value: unknown) => {
  const text = JSON.stringify(value)
  for (const secret of [
    xtreamCredentials.username,
    xtreamCredentials.password,
    encodeURIComponent(xtreamCredentials.password),
  ])
    expect(text).not.toContain(secret)
  expect(text).not.toContain('player_api')
}

describe('xtream provider: channels', () => {
  test('reads the account, then its live categories and streams', async () => {
    const result = await provider.listChannels({ settings: settings() })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.channels.map((channel) => channel.key)).toEqual([
      'stream:103',
      'stream:101',
      'stream:102',
      'stream:110',
    ])
    expect(result.value.account).toEqual({ maxConnections: 2 })
    expect(result.value).not.toHaveProperty('guideUrl')
    const encoded = `username=projo-user&password=${encodeURIComponent('s3cret/pass')}`
    expect(iptv.requests.map((request) => request.path)).toEqual([
      `/player_api.php?${encoded}`,
      `/player_api.php?${encoded}&action=get_live_categories`,
      `/player_api.php?${encoded}&action=get_live_streams`,
    ])
  })

  test('wrong credentials: the account is refused, without the credentials anywhere', async () => {
    const result = await provider.listChannels({ settings: settings({ password: 'wrong-pass' }) })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/account_refused', context: { reason: 'auth_failed' } },
    })
    expect(JSON.stringify(result)).not.toContain('wrong-pass')
  })

  test.each([
    [{ status: 'Expired' }, 'expired'],
    [{ status: 'Banned' }, 'banned'],
    [{ status: 'Disabled' }, 'disabled'],
    [{ exp_date: String(now.getTime() / 1000 - 3600) }, 'expired'],
  ])('an account %p is refused (%s)', async (patch, reason) => {
    iptv.setXtreamAccount(patch)
    const result = await provider.listChannels({ settings: settings() })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/account_refused', context: { reason } },
    })
    expectNoCredentials(result)
  })

  test('an HTTP 401 is a refused account', async () => {
    iptv.override('/player_api.php', { status: 401 })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/account_refused', context: { reason: 'auth_failed' } },
    })
  })

  test('an account without ts nor m3u8 has no output format', async () => {
    iptv.setXtreamAccount({ allowed_output_formats: ['rtmp'] })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'no_output_format' } },
    })
  })

  test('an account allowing only m3u8 lists HLS upstreams', async () => {
    iptv.setXtreamAccount({ allowed_output_formats: ['m3u8'], max_connections: jsonNull })
    const result = await provider.listChannels({ settings: settings() })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.channels[0]?.upstream).toEqual({ url: 'live/103.m3u8' })
    expect(result.value.account).toEqual({})
  })

  test('an answer that is not the API is invalid, an error status unreachable', async () => {
    iptv.override('/player_api.php', '<html>panel</html>')
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_xtream' } },
    })
    iptv.override('/player_api.php', { status: 503 })
    const unreachable = await provider.listChannels({ settings: settings() })
    expect(unreachable).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_unreachable',
        context: { host: new URL(iptv.url).host, reason: 'http_status', status: 503 },
      },
    })
    expectNoCredentials(unreachable)
  })

  test('redirects are followed, never from https down to http (§29.2)', async () => {
    const asked: string[] = []
    /** `<scheme>://moved.test/…` redirects to the test panel (`http`) on the same path. */
    const moving: Fetch = (input, init) => {
      asked.push(input)
      const url = new URL(input)
      if (url.host !== 'moved.test') return fetch(input, init)
      expect(init.redirect).toBe('manual')
      return Promise.resolve(
        new Response(undefined, {
          status: 302,
          headers: { Location: `${iptv.url}${url.pathname}${url.search}` },
        }),
      )
    }
    const moved = createXtreamProvider({ fetch: moving, now: () => now })
    const followed = await moved.listChannels({
      settings: { ...settings(), serverUrl: 'http://moved.test' },
    })
    expect(followed.ok && followed.value.channels).toHaveLength(4)

    asked.length = 0
    const downgraded = await moved.listChannels({
      settings: { ...settings(), serverUrl: 'https://moved.test' },
    })
    expect(downgraded).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_unreachable',
        context: { host: 'moved.test', reason: 'insecure_redirect' },
      },
    })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toStartWith('https://moved.test/')
    expectNoCredentials(downgraded)
  })

  test('a network failure or a timeout gives a fixed reason, never the URL', async () => {
    const failing: Fetch = (input) =>
      Promise.reject(new Error(`Unable to connect. Is the computer able to access ${input}?`))
    const result = await createXtreamProvider({ fetch: failing }).listChannels({
      settings: settings(),
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/source_unreachable', context: { reason: 'network' } },
    })
    expectNoCredentials(result)
    const hanging: Fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    expect(
      await createXtreamProvider({ fetch: hanging, timeoutMs: 20 }).listChannels({
        settings: settings(),
      }),
    ).toMatchObject({ ok: false, error: { context: { reason: 'timeout' } } })
  })

  test('an answer past the limit is too large', async () => {
    expect(
      await createXtreamProvider({ maxBytes: 100 }).listChannels({ settings: settings() }),
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'too_large' } },
    })
  })

  test('a list that is not an array is not the API', async () => {
    const notAList: Fetch = (input, init) =>
      input.includes('action=')
        ? Promise.resolve(Response.json({ error: 'nope' }))
        : fetch(input, init)
    expect(
      await createXtreamProvider({ fetch: notAList }).listChannels({ settings: settings() }),
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_xtream' } },
    })
  })

  test('no live channel at all is invalid (the channels stay as they were)', async () => {
    const onlyRadio: Fetch = (input, init) =>
      input.includes('action=get_live_streams')
        ? Promise.resolve(
            Response.json([{ stream_id: 1, name: 'Radio', stream_type: 'radio_streams' }]),
          )
        : fetch(input, init)
    expect(
      await createXtreamProvider({ fetch: onlyRadio }).listChannels({ settings: settings() }),
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'no_live_channel' } },
    })
  })
})

describe('xtream provider: guide and upstream', () => {
  test("reads the account's xmltv.php", async () => {
    const programmes: TvGuideProgramme[] = []
    const result = await provider.readGuide({
      settings: settings(),
      sink: { channel: () => {}, programme: (programme) => programmes.push(programme) },
    })
    expect(result).toEqual({ ok: true, value: { available: true } })
    expect(programmes.map((programme) => programme.titles[0]?.text)).toEqual([
      'Xtream news',
      'Xtream weather',
      'Xtream match',
    ])
    expect(iptv.requests.map((request) => request.path)).toEqual([
      `/xmltv.php?username=projo-user&password=${encodeURIComponent('s3cret/pass')}`,
    ])
  })

  test('a refused guide gives the host and a fixed reason only', async () => {
    const result = await provider.readGuide({
      settings: settings({ password: 'wrong-pass' }),
      sink: { channel: () => {}, programme: () => {} },
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'http_status', status: 401 } },
    })
    expect(JSON.stringify(result)).not.toContain('wrong-pass')
  })

  test('the upstream gets the current credentials when a stream opens', () => {
    expect(provider.upstreamOf({ settings: settings(), upstream: { url: 'live/101.ts' } })).toEqual(
      {
        url: `${iptv.url}/live/projo-user/s3cret%2Fpass/101.ts`,
        secrets: ['projo-user', 's3cret/pass'],
      },
    )
  })
})
