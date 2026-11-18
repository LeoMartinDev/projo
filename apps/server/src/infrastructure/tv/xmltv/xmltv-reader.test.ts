import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { deflateSync } from 'node:zlib'

import type { TvGuideChannel, TvGuideProgramme } from '../../../core/tv/guide.ts'
import { type IptvServer, startIptvServer } from '../../../../test/support/iptv-server.ts'
import { createM3uProvider } from '../m3u/m3u-provider.ts'
import { readXmltv, type XmltvReaderOptions } from './xmltv-reader.ts'

const now = new Date('2026-06-10T12:00:00.000Z')

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer({ requireUserAgent: 'Box/1' })
  iptv.setGuideNow(() => now)
})
afterAll(() => iptv.stop())

const read = async (url: string, options: XmltvReaderOptions = {}, userAgent = 'Box/1') => {
  const channels: TvGuideChannel[] = []
  const programmes: TvGuideProgramme[] = []
  const result = await readXmltv(
    {
      url,
      userAgent,
      sink: {
        channel: (channel) => channels.push(channel),
        programme: (programme) => programmes.push(programme),
      },
    },
    options,
  )
  return { result, channels, programmes }
}

describe('reading an XMLTV guide (§29.3)', () => {
  test('plain, gzipped as a file, or with a gzip Content-Encoding: the same guide', async () => {
    const plain = await read(iptv.at('/xmltv/guide.xml'))
    expect(plain.result).toEqual({ ok: true, value: { available: true } })
    expect(plain.channels.map((channel) => channel.id)).toEqual([
      'news.one',
      'NEWS.TWO',
      'sport.one',
      'local.tv',
      'absent.tv',
      'kids.one',
      'sport.two.example',
    ])
    expect(plain.programmes).toHaveLength(13)
    // `{{at:-30:+0200}}`: half an hour ago, written in +02:00.
    expect(plain.programmes[1]?.start).toEqual(new Date(now.getTime() - 30 * 60_000))
    for (const path of ['/xmltv/guide.xml.gz', '/xmltv/guide.xml?encoding=gzip']) {
      const other = await read(iptv.at(path))
      expect(other.result.ok).toBe(true)
      expect(other.programmes).toEqual(plain.programmes)
    }
  })

  test('sends the User-Agent; an error status, a refused request, an HTML page', async () => {
    expect((await read(iptv.at('/xmltv/guide.xml'), {}, 'Other/1')).result).toMatchObject({
      ok: false,
      error: {
        code: 'tv/guide_unreachable',
        context: { host: new URL(iptv.url).host, reason: 'http_status', status: 403 },
      },
    })
    expect((await read(iptv.at('/xmltv/missing.xml?token=secret'))).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'http_status', status: 404 } },
    })
    const unreachable = await read('http://127.0.0.1:9/guide.xml?token=secret')
    expect(unreachable.result).toMatchObject({ ok: false, error: { code: 'tv/guide_unreachable' } })
    expect(JSON.stringify(unreachable.result)).not.toContain('secret')
    expect((await read(iptv.at('/xmltv/expired.html'))).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'not_xmltv' } },
    })
  })

  test('refused past its size, received or decompressed', async () => {
    expect((await read(iptv.at('/xmltv/guide.xml'), { maxBytes: 1000 })).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'too_large' } },
    })
    const gzipped = await read(iptv.at('/xmltv/guide.xml.gz'), { maxDecodedBytes: 1000 })
    expect(gzipped.result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'too_large' } },
    })
  })

  test('redirects are followed one by one, never from https down to http nor past 5', async () => {
    const asked: string[] = []
    /** `/hop/<n>/…` redirects to `/hop/<n-1>/…`; `/hop/0/<rest>` to the test provider's `/<rest>`. */
    const hops =
      (
        target: (hop: number, rest: string, url: URL) => string,
      ): NonNullable<XmltvReaderOptions['fetch']> =>
      async (input, init) => {
        asked.push(input)
        expect(init.redirect).toBe('manual')
        const url = new URL(input)
        const match = /^\/hop\/(\d+)\/(.*)$/u.exec(url.pathname) ?? undefined
        if (match === undefined) return fetch(input, init)
        return new Response(undefined, {
          status: 302,
          headers: { Location: target(Number(match[1]), match[2] ?? '', url) },
        })
      }
    const relative = hops((hop, rest) =>
      hop === 0 ? iptv.at(`/${rest}`) : `/hop/${hop - 1}/${rest}`,
    )
    const followed = await read('http://guide.test/hop/3/xmltv/guide.xml', { fetch: relative })
    expect(followed.result).toEqual({ ok: true, value: { available: true } })
    expect(followed.programmes.length).toBeGreaterThan(0)
    expect(asked).toHaveLength(5)

    expect(
      (await read('http://guide.test/hop/5/xmltv/guide.xml', { fetch: relative })).result,
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'too_many_redirects' } },
    })

    asked.length = 0
    const downgrading = hops(() => 'http://guide.test/xmltv/guide.xml?token=secret')
    const refused = await read('https://guide.test/hop/0/g?token=secret', { fetch: downgrading })
    expect(refused.result).toMatchObject({
      ok: false,
      error: {
        code: 'tv/guide_unreachable',
        context: { host: 'guide.test', reason: 'insecure_redirect' },
      },
    })
    expect(asked).toEqual(['https://guide.test/hop/0/g?token=secret'])
    expect(JSON.stringify(refused.result)).not.toContain('secret')

    const local = hops(() => 'file:///etc/passwd')
    expect((await read('http://guide.test/hop/0/g', { fetch: local })).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_unreachable', context: { reason: 'unsupported_redirect' } },
    })
  })

  test('a Content-Encoding body counts as received before it is decompressed', async () => {
    // Highly compressible: 300 bytes or so on the wire, 60,000 once decompressed.
    const xml = Buffer.from(
      `<tv><!--${'x'.repeat(60_000)}--><programme channel="c" start="20260610120000"><title>T</title></programme></tv>`,
    )
    const encoded =
      (encoding: string, bytes: Uint8Array): NonNullable<XmltvReaderOptions['fetch']> =>
      async (_url, init) => {
        // Never decompressed by the client: the wire's bytes are what is counted.
        expect(init.decompress).toBe(false)
        return new Response(bytes, { headers: { 'content-encoding': encoding } })
      }
    const gzip = Bun.gzipSync(xml)
    expect(gzip.byteLength).toBeLessThan(1000)
    const fits = await read('http://guide.test/g', {
      fetch: encoded('gzip', gzip),
      maxBytes: 1000,
      maxDecodedBytes: 100_000,
    })
    expect(fits.result).toEqual({ ok: true, value: { available: true } })
    expect(fits.programmes).toHaveLength(1)
    const deflate = await read('http://guide.test/g', {
      fetch: encoded('deflate', deflateSync(xml)),
      maxBytes: 1000,
      maxDecodedBytes: 100_000,
    })
    expect(deflate.programmes).toHaveLength(1)
    expect(
      (
        await read('http://guide.test/g', {
          fetch: encoded('gzip', gzip),
          maxBytes: 1000,
          maxDecodedBytes: 10_000,
        })
      ).result,
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'too_large' } },
    })
    expect(
      (await read('http://guide.test/g', { fetch: encoded('br', gzip) })).result,
    ).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'encoding' } },
    })
  })

  test('a body in odd chunks (a one-byte first one) and a corrupt gzip', async () => {
    const xml = Buffer.from(
      '<tv><programme channel="c" start="20260610120000"><title>T</title></programme></tv>',
    )
    const gzip = Bun.gzipSync(xml)
    const chunked =
      (bytes: Uint8Array): NonNullable<XmltvReaderOptions['fetch']> =>
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => {
              for (let index = 0; index < bytes.length; index += index === 0 ? 1 : 5)
                controller.enqueue(bytes.slice(index, index === 0 ? 1 : index + 5))
              controller.close()
            },
          }),
        )
    for (const bytes of [xml, gzip]) {
      const { result, programmes } = await read('http://guide.test/g', { fetch: chunked(bytes) })
      expect(result.ok).toBe(true)
      expect(programmes).toHaveLength(1)
    }
    const corrupt = Uint8Array.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect((await read('http://guide.test/g', { fetch: chunked(corrupt) })).result).toMatchObject({
      ok: false,
      error: { code: 'tv/guide_invalid', context: { reason: 'corrupt' } },
    })
  })
})

describe('the m3u connector reads its guide (§29.3)', () => {
  const provider = createM3uProvider()
  const guideOf = async (source: { guideUrl?: string; discoveredGuideUrl?: string }) => {
    const programmes: TvGuideProgramme[] = []
    const result = await provider.readGuide({
      source: {
        settings: {
          kind: 'm3u',
          playlistUrl: iptv.at('/m3u/playlist.m3u'),
          userAgent: 'Box/1',
          ...(source.guideUrl === undefined ? {} : { guideUrl: source.guideUrl }),
        },
        ...(source.discoveredGuideUrl === undefined
          ? {}
          : { discoveredGuideUrl: source.discoveredGuideUrl }),
      },
      sink: { channel: () => {}, programme: (programme) => programmes.push(programme) },
    })
    return { result, programmes }
  }

  test("the settings' XMLTV URL, else the playlist's, else none", async () => {
    const both = await guideOf({
      guideUrl: iptv.at('/xmltv/live.xml'),
      discoveredGuideUrl: iptv.at('/xmltv/guide.xml'),
    })
    expect(both.programmes).toHaveLength(4)
    const discovered = await guideOf({ discoveredGuideUrl: iptv.at('/xmltv/guide.xml.gz') })
    expect(discovered.programmes).toHaveLength(13)
    expect(await guideOf({})).toEqual({
      result: { ok: true, value: { available: false } },
      programmes: [],
    })
  })
})
