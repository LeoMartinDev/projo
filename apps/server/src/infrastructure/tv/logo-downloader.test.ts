import { afterAll, beforeAll, expect, test } from 'bun:test'

import { type IptvServer, PNG_BYTES, startIptvServer } from '../../../test/support/iptv-server.ts'
import { createTvLogoDownloader, isRefusedLogoAddress } from './logo-downloader.ts'

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
})
afterAll(() => iptv.stop())

// The test provider is on this machine: loopback allowed here, refused by default.
const downloader = createTvLogoDownloader({ allowLoopback: true })
const reasonOf = (result: Awaited<ReturnType<typeof downloader.download>>) =>
  result.ok ? 'ok' : String(result.error.context?.['reason'])

test('downloads an image with the given User-Agent', async () => {
  const result = await downloader.download({ url: iptv.at('/logos/a.png'), userAgent: 'Box/1' })
  expect(result).toEqual({ ok: true, value: { bytes: PNG_BYTES, type: 'png' } })
  expect(iptv.requests.at(-1)?.userAgent).toBe('Box/1')
  for (const type of ['jpg', 'webp', 'gif'] as const) {
    expect(await downloader.download({ url: iptv.at(`/logos/a.${type}`) })).toMatchObject({
      ok: true,
      value: { type },
    })
  }
})

test('refuses SVG, a missing file, a file too large and a non-http URL', async () => {
  const reasons = await Promise.all(
    [
      iptv.at('/logos/a.svg'),
      iptv.at('/logos/missing.png'),
      iptv.at('/logos/huge.png'),
      'ftp://host/logo.png',
    ].map(async (url) => {
      const result = await downloader.download({ url })
      return result.ok ? 'ok' : `${result.error.code} ${String(result.error.context?.['reason'])}`
    }),
  )
  expect(reasons).toEqual([
    'tv/logo_unavailable not_an_image',
    'tv/logo_unavailable http_404',
    'tv/logo_unavailable too_large',
    'tv/logo_unavailable unsupported_url',
  ])
})

test('refuses loopback, link-local, unspecified and multicast addresses; LAN ones pass', () => {
  for (const address of [
    '127.0.0.1',
    '127.8.0.1',
    '::1',
    '[::1]',
    '169.254.169.254',
    'fe80::1',
    'fe80::1%eth0',
    '0.0.0.0',
    '::',
    '224.0.0.1',
    'ff02::1',
    '255.255.255.255',
    '::ffff:127.0.0.1',
    '::ffff:a9fe:a9fe',
    'not-an-address',
  ])
    expect([address, isRefusedLogoAddress(address)]).toEqual([address, true])
  for (const address of ['192.168.1.254', '10.0.0.2', '172.16.0.1', '93.184.216.34', 'fd00::1'])
    expect([address, isRefusedLogoAddress(address)]).toEqual([address, false])
  expect(isRefusedLogoAddress('127.0.0.1', { allowLoopback: true })).toBe(false)
  expect(isRefusedLogoAddress('169.254.169.254', { allowLoopback: true })).toBe(true)
})

test('refuses a host resolving to a refused address, before any request', async () => {
  const strict = createTvLogoDownloader()
  const before = iptv.requests.length
  expect(reasonOf(await strict.download({ url: iptv.at('/logos/a.png') }))).toBe('refused_address')
  expect(iptv.requests.length).toBe(before)

  const requested: string[] = []
  const metadata = createTvLogoDownloader({
    lookup: async () => ['169.254.169.254'],
    fetch: async (input) => {
      requested.push(input)
      return new Response('{}')
    },
  })
  expect(reasonOf(await metadata.download({ url: 'http://logos.example/a.png' }))).toBe(
    'refused_address',
  )
  expect(requested).toEqual([])
})

test('follows redirects by hand, checking each hop, at most five', async () => {
  const requested: string[] = []
  const redirecting = (location: (url: string) => string) =>
    createTvLogoDownloader({
      lookup: async (hostname) =>
        hostname === 'metadata.internal' ? ['169.254.169.254'] : ['93.184.216.34'],
      fetch: async (input, init) => {
        requested.push(input)
        expect(init.redirect).toBe('manual')
        return input.endsWith('/final.png')
          ? new Response(PNG_BYTES)
          : new Response(undefined, { status: 302, headers: { location: location(input) } })
      },
    })

  const relative = redirecting(() => '/final.png')
  expect(await relative.download({ url: 'http://cdn.example/a.png' })).toMatchObject({
    ok: true,
    value: { type: 'png' },
  })
  expect(requested).toEqual(['http://cdn.example/a.png', 'http://cdn.example/final.png'])

  requested.length = 0
  const toMetadata = redirecting(() => 'http://metadata.internal/latest/a.png')
  expect(reasonOf(await toMetadata.download({ url: 'http://cdn.example/a.png' }))).toBe(
    'refused_address',
  )
  expect(requested).toEqual(['http://cdn.example/a.png'])

  requested.length = 0
  const toLoopback = redirecting(() => 'http://127.0.0.1:8080/final.png')
  expect(reasonOf(await toLoopback.download({ url: 'http://cdn.example/a.png' }))).toBe(
    'refused_address',
  )

  requested.length = 0
  const looping = redirecting((url) => `${url}x`)
  expect(reasonOf(await looping.download({ url: 'http://cdn.example/a.png' }))).toBe(
    'too_many_redirects',
  )
  expect(requested).toHaveLength(6)
})

test('a failed request gives a fixed reason, never the error nor the URL secret', async () => {
  const secretUrl = 'http://logos.example/logo.png?token=SECRET'
  const leaky = Object.assign(
    new TypeError(`UnsupportedRedirectProtocol fetching "${secretUrl}". For more information…`),
    { code: 'UnsupportedRedirectProtocol' },
  )
  const rejecting = createTvLogoDownloader({
    lookup: async () => ['93.184.216.34'],
    fetch: () => Promise.reject(leaky),
  })
  const result = await rejecting.download({ url: secretUrl })
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'tv/logo_unavailable',
      context: { host: 'logos.example', reason: 'UnsupportedRedirectProtocol' },
    },
  })
  if (result.ok) throw new Error('expected a failure')
  expect(result.error.cause).toBeUndefined()
  expect(JSON.stringify(result.error)).not.toContain('SECRET')

  const unresolved = createTvLogoDownloader({
    lookup: () =>
      Promise.reject(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${secretUrl}`), { code: 'ENOTFOUND' }),
      ),
  })
  const notFound = await unresolved.download({ url: secretUrl })
  expect(reasonOf(notFound)).toBe('ENOTFOUND')
  expect(JSON.stringify(notFound)).not.toContain('SECRET')
})
