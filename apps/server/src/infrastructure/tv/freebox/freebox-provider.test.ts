import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'

import type { TvGuideProgramme } from '../../../core/tv/guide.ts'
import { type IptvServer, startIptvServer } from '../../../../test/support/iptv-server.ts'
import type { Fetch } from './freebox-api.ts'
import { freeboxGuideSlots } from './freebox-guide.ts'
import { createFreeboxProvider } from './freebox-provider.ts'

const now = new Date('2026-11-18T13:02:00Z')

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
  iptv.setGuideNow(() => now)
})
afterAll(() => iptv.stop())
afterEach(() => {
  for (const path of [
    '/api_version',
    '/api/v8/tv/channels',
    '/api/v8/tv/bouquets/freeboxtv/channels',
    `/api/v8/tv/epg/by_time/${freeboxGuideSlots(now)[3]}`,
    '/api_version_moved',
  ])
    iptv.restore(path)
  iptv.requests.length = 0
})

const provider = createFreeboxProvider({ now: () => now })

/** A box that never answers: the call ends only when its signal aborts. */
const hangingFetch: Fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init.signal ?? undefined
    if (signal === undefined) return
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
const settings = () => ({ kind: 'freebox' as const, address: `${iptv.url}/` })

const readGuide = async (from = provider) => {
  const programmes: TvGuideProgramme[] = []
  const result = await from.readGuide({
    settings: settings(),
    sink: { channel: () => {}, programme: (programme) => programmes.push(programme) },
  })
  return { result, programmes }
}

describe('freebox provider: channels', () => {
  test('discovers the API, then joins the channels and the bouquet', async () => {
    const result = await provider.listChannels({ settings: settings() })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.channels.map((channel) => channel.name)).toEqual([
      'France 2',
      "France 3 Provence-Alpes-Côte d'Azur",
      'Arte',
      'Paris Première',
      'Télé Bocal',
      'TV78',
    ])
    expect(result.value.channels[0]?.logoUrl).toBe(
      `${iptv.url}/api/latest/tv/img/channels/logos68x60/uuid-webtv-201.png`,
    )
    expect(result.value).not.toHaveProperty('guideUrl')
    expect(iptv.requests.map((request) => request.path)).toEqual([
      '/api_version',
      '/api/v8/tv/channels',
      '/api/v8/tv/bouquets/freeboxtv/channels',
    ])
  })

  test('an answer that is not the API is invalid', async () => {
    iptv.override('/api_version', '<html>router</html>')
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_freebox' } },
    })
  })

  test('an API base on another host is refused', async () => {
    iptv.override('/api_version', '{"api_base_url":"//evil.example/","api_version":"16.1"}')
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_freebox' } },
    })
    expect(iptv.requests).toHaveLength(1)
  })

  test('a box below version 8 is too old', async () => {
    iptv.override('/api_version', '{"api_base_url":"/api/","api_version":"7.0"}')
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'api_too_old' } },
    })
  })

  test("the box's refusal is an API error with its code, whatever its HTTP status", async () => {
    iptv.override('/api/v8/tv/channels', {
      status: 403,
      body: '{"success":false,"error_code":"auth_required","msg":"Il faut être connecté"}',
    })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_invalid',
        context: { reason: 'api_error', errorCode: 'auth_required', status: 403 },
      },
    })
    iptv.override(
      '/api/v8/tv/channels',
      '{"success":false,"error_code":"internal_error","msg":"Erreur interne"}',
    )
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_invalid',
        context: { reason: 'api_error', errorCode: 'internal_error' },
      },
    })
  })

  test('an HTTP error status without the envelope or a closed port is unreachable', async () => {
    iptv.override('/api/v8/tv/bouquets/freeboxtv/channels', {
      status: 502,
      body: '<html>Bad gateway</html>',
    })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_unreachable',
        context: { host: new URL(iptv.url).host, reason: 'http_status', status: 502 },
      },
    })
    iptv.override('/api/v8/tv/bouquets/freeboxtv/channels', { status: 500 })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_unreachable',
        context: { host: new URL(iptv.url).host, reason: 'http_status', status: 500 },
      },
    })
    expect(
      await provider.listChannels({ settings: { kind: 'freebox', address: 'http://127.0.0.1:1' } }),
    ).toMatchObject({ ok: false, error: { code: 'tv/source_unreachable' } })
  })

  test('an answer past the size limit is invalid, one without a channel too', async () => {
    const small = createFreeboxProvider({ maxBytes: 2048 })
    expect(await small.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'too_large' } },
    })
    iptv.override('/api/v8/tv/bouquets/freeboxtv/channels', '{"success":true,"result":[]}')
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'no_live_channel' } },
    })
  })

  test('a call that does not answer in time is unreachable', async () => {
    const hanging = createFreeboxProvider({ fetch: hangingFetch, timeoutMs: 50 })
    const started = Date.now()
    expect(await hanging.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_unreachable', context: { reason: 'timeout' } },
    })
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test('redirects are followed on the box only', async () => {
    iptv.override('/api_version', { status: 302, location: '/api_version_moved' })
    iptv.override('/api_version_moved', '{"api_base_url":"/api/","api_version":"16.1"}')
    expect((await provider.listChannels({ settings: settings() })).ok).toBe(true)
    iptv.override('/api_version', { status: 302, location: 'http://127.0.0.2:1/api_version' })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_freebox' } },
    })
    iptv.override('/api_version', { status: 302, location: '/api_version' })
    expect(await provider.listChannels({ settings: settings() })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_freebox' } },
    })
  })

  test('the upstream is the rtsp URL as the box gives it', () => {
    const upstream = { url: 'rtsp://mafreebox.freebox.fr/fbxtv_pub/stream?namespace=1&service=201' }
    expect(provider.upstreamOf({ settings: settings(), upstream })).toEqual(upstream)
  })
})

describe('freebox provider: guide', () => {
  test('reads 79 hours from 6 hours ago, each programme once, with its picture', async () => {
    const { result, programmes } = await readGuide()
    expect(result).toEqual({ ok: true, value: { available: true } })
    const byTime = iptv.requests.filter((request) => request.path.includes('/epg/by_time/'))
    expect(byTime.map((request) => request.path)).toEqual(
      freeboxGuideSlots(now).map((slot) => `/api/v8/tv/epg/by_time/${slot}`),
    )
    const france2 = programmes.filter((programme) => programme.channel === 'uuid-webtv-201')
    expect(france2.map((programme) => programme.titles[0]?.text)).toEqual([
      "Ça commence aujourd'hui",
      "Je t'aime, etc.",
      'Télématin',
      'Past the window',
    ])
    expect(france2[0]).toMatchObject({
      start: new Date(now.getTime() - 8 * 60_000),
      stop: new Date(now.getTime() + 62 * 60_000),
      subtitles: [{ text: 'Syndrome de Diogène : ils vivent emprisonnés de leurs objets' }],
      categories: [{ text: 'Magazine' }],
      // `picture_big`, resolved on the box's origin.
      images: [
        `${new URL(settings().address).origin}/api/latest/tv/img/epg/programs/168x130/COL_52831102_AG.jpg`,
      ],
    })
    expect(france2[1]?.images).toEqual([])
  })

  test('a failed hour fails the read', async () => {
    iptv.override(`/api/v8/tv/epg/by_time/${freeboxGuideSlots(now)[3]}`, { status: 503 })
    expect((await readGuide()).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'http_status', status: 503 } },
    })
    iptv.override(`/api/v8/tv/epg/by_time/${freeboxGuideSlots(now)[3]}`, '{"result":{}}')
    expect((await readGuide()).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'not_freebox' } },
    })
  })

  test('refused for its rate, the read waits, asks that hour again, then keeps a pace', async () => {
    const slots = freeboxGuideSlots(now)
    let refusals = 2
    const limited: Fetch = (input, init) => {
      if (input.endsWith(`/epg/by_time/${slots[4]}`) && refusals > 0) {
        refusals -= 1
        return Promise.resolve(
          new Response('{"success":false,"error_code":"rate_limit","msg":"Too many requests"}', {
            status: 429,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }
      return fetch(input, init)
    }
    const waits: number[] = []
    const paced = createFreeboxProvider({
      now: () => now,
      fetch: limited,
      wait: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      },
    })
    const { result, programmes } = await readGuide(paced)
    expect(result).toEqual({ ok: true, value: { available: true } })
    expect(programmes.length).toBeGreaterThan(0)
    // 2 s, then the pace before asking again, 5 s, the pace, then the pace before each later hour.
    expect(waits.slice(0, 4)).toEqual([2_000, 1_000, 5_000, 1_000])
    expect(waits.slice(4)).toEqual(Array.from({ length: slots.length - 5 }, () => 1_000))

    // Still refused after every wait: the read fails, the stored guide stays (§29.3).
    refusals = Number.POSITIVE_INFINITY
    expect((await readGuide(paced)).result).toMatchObject({
      ok: false,
      error: {
        code: 'tv/guide_invalid',
        context: { reason: 'api_error', errorCode: 'rate_limit' },
      },
    })
  })

  test('the whole read shares one deadline, and stops when aborted', async () => {
    const slots = freeboxGuideSlots(now)
    const calls: string[] = []
    const slow: Fetch = (input, init) => {
      calls.push(input)
      return input.endsWith(`/epg/by_time/${slots[2]}`)
        ? hangingFetch(input, init)
        : fetch(input, init)
    }
    const started = Date.now()
    const timed = createFreeboxProvider({ now: () => now, fetch: slow, guideTimeoutMs: 300 })
    expect((await readGuide(timed)).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'timeout' } },
    })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(calls.filter((call) => call.includes('/epg/by_time/'))).toHaveLength(3)

    calls.length = 0
    const controller = new AbortController()
    const aborting: Fetch = (input, init) => {
      if (input.endsWith(`/epg/by_time/${slots[1]}`)) controller.abort()
      return slow(input, init)
    }
    const aborted = createFreeboxProvider({ now: () => now, fetch: aborting })
    const result = await aborted.readGuide({
      settings: settings(),
      sink: { channel: () => {}, programme: () => {} },
      signal: controller.signal,
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'aborted' } },
    })
    expect(calls.filter((call) => call.includes('/epg/by_time/'))).toHaveLength(2)
  })

  test('a box that does not answer has no guide', async () => {
    iptv.override('/api_version', { status: 404 })
    expect((await readGuide()).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable' },
    })
  })
})
