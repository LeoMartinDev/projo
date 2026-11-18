import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { type IptvServer, startIptvServer } from '../../../../test/support/iptv-server.ts'
import { createM3uProvider } from './m3u-provider.ts'

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer({ requireUserAgent: 'ProviderBox/1.0' })
})
afterAll(() => iptv.stop())

const provider = createM3uProvider()
const settings = (path: string, userAgent: string | undefined = 'ProviderBox/1.0') => ({
  kind: 'm3u' as const,
  playlistUrl: iptv.at(path),
  ...(userAgent === undefined ? {} : { userAgent }),
})

describe('m3u provider', () => {
  test('lists the live channels with the source User-Agent and the header guide', async () => {
    const result = await provider.listChannels({ settings: settings('/m3u/playlist.m3u') })
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value.channels).toHaveLength(8)
    expect(result.value.guideUrl).toBe(iptv.at('/xmltv/guide.xml.gz'))
    expect(iptv.requests.at(-1)?.userAgent).toBe('ProviderBox/1.0')
  })

  test('an HTTP error status is unreachable, without the secret in the error', async () => {
    const result = await provider.listChannels({
      settings: settings('/m3u/playlist.m3u', 'Other/1.0'),
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/source_unreachable', context: { status: 403, reason: 'http_status' } },
    })
    expect(JSON.stringify(result.ok ? {} : result.error.context)).not.toContain('playlist.m3u')
  })

  test('a refused connection is unreachable', async () => {
    const closed = createM3uProvider()
    const result = await closed.listChannels({
      settings: { kind: 'm3u', playlistUrl: 'http://127.0.0.1:1/get.php?password=secret' },
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'tv/source_unreachable' } })
  })

  test('a failed request never carries the secret of the URL: a fixed reason, no cause', async () => {
    const secretUrl = 'http://provider.example/get.php?username=leo&password=SECRET'
    const leaky = Object.assign(
      new TypeError(`InvalidHTTPResponse fetching "${secretUrl}". For more information…`),
      { code: 'InvalidHTTPResponse' },
    )
    const rejecting = createM3uProvider({ fetch: () => Promise.reject(leaky) })
    const failed = await rejecting.listChannels({
      settings: { kind: 'm3u', playlistUrl: secretUrl },
    })
    expect(failed).toMatchObject({
      ok: false,
      error: {
        code: 'tv/source_unreachable',
        context: { host: 'provider.example', reason: 'InvalidHTTPResponse' },
      },
    })
    if (failed.ok) throw new Error('expected a failure')
    expect(failed.error.cause).toBeUndefined()
    expect(JSON.stringify(failed.error)).not.toContain('SECRET')

    const odd = createM3uProvider({ fetch: () => Promise.reject(new Error(secretUrl)) })
    const unknown = await odd.listChannels({ settings: { kind: 'm3u', playlistUrl: secretUrl } })
    expect(unknown).toMatchObject({ ok: false, error: { context: { reason: 'network' } } })

    // Bun's own message of a redirect to another scheme holds the requested URL.
    iptv.override('/m3u/redirected.m3u', { status: 302, location: 'ftp://elsewhere/list.m3u' })
    const redirected = await provider.listChannels({
      settings: {
        ...settings('/m3u/redirected.m3u'),
        playlistUrl: iptv.at('/m3u/redirected.m3u?password=SECRET'),
      },
    })
    iptv.restore('/m3u/redirected.m3u')
    expect(redirected).toMatchObject({
      ok: false,
      error: { context: { reason: 'unsupported_redirect' } },
    })
    expect(JSON.stringify(redirected.ok ? {} : redirected.error)).not.toContain('SECRET')
  })

  test('a redirect from https down to http is refused: the URL carries the secret', async () => {
    const requested: string[] = []
    const downgrading = createM3uProvider({
      fetch: (input) => {
        requested.push(input)
        return Promise.resolve(
          new Response(undefined, {
            status: 302,
            headers: { location: 'http://provider.example/list.m3u?token=SECRET' },
          }),
        )
      },
    })
    const result = await downgrading.listChannels({
      settings: { kind: 'm3u', playlistUrl: 'https://provider.example/list.m3u?token=SECRET' },
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'tv/source_unreachable', context: { reason: 'insecure_redirect' } },
    })
    expect(requested).toEqual(['https://provider.example/list.m3u?token=SECRET'])
  })

  test('an answer that is not a playlist, or holds no live channel, is invalid', async () => {
    expect(await provider.listChannels({ settings: settings('/m3u/expired.html') })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'not_a_playlist' } },
    })
    expect(await provider.listChannels({ settings: settings('/m3u/empty.m3u') })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'no_live_channel' } },
    })
  })

  test('a playlist past the size limit is invalid', async () => {
    const small = createM3uProvider({ maxBytes: 200 })
    expect(await small.listChannels({ settings: settings('/m3u/playlist.m3u') })).toMatchObject({
      ok: false,
      error: { code: 'tv/source_invalid', context: { reason: 'too_large' } },
    })
  })

  test('upstreamOf gives the source User-Agent to a channel without its own', () => {
    expect(
      provider.upstreamOf({
        settings: settings('/m3u/playlist.m3u'),
        upstream: { url: 'http://a/1.ts' },
      }),
    ).toEqual({ url: 'http://a/1.ts', userAgent: 'ProviderBox/1.0' })
    expect(
      provider.upstreamOf({
        settings: settings('/m3u/playlist.m3u'),
        upstream: { url: 'http://a/1.ts', userAgent: 'Own/1', referrer: 'http://r' },
      }),
    ).toEqual({ url: 'http://a/1.ts', userAgent: 'Own/1', referrer: 'http://r' })
  })
})
