import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { iptvFixturesDir } from '../../../../test/support/iptv-server.ts'
import { bestRtspOf, FREEBOX_GROUP, freeboxChannelsOf } from './freebox-channels.ts'

const fixture = (name: string): unknown =>
  (JSON.parse(readFileSync(join(iptvFixturesDir, 'freebox', name), 'utf8')) as { result: unknown })
    .result

const address = 'http://mafreebox.freebox.fr'
const rtsp = (service: number, flavour?: string) =>
  `rtsp://mafreebox.freebox.fr/fbxtv_pub/stream?namespace=1&service=${service}${flavour === undefined ? '' : `&flavour=${flavour}`}`

describe('freeboxChannelsOf (answers of a real box)', () => {
  const channels = freeboxChannelsOf({
    address,
    channels: fixture('channels.json'),
    bouquet: fixture('bouquet-freeboxtv.json'),
  })

  test('joins the bouquet with the channels, ordered by number, one channel per uuid', () => {
    expect(channels.map((channel) => [channel.number, channel.name])).toEqual([
      [2, 'France 2'],
      [3, "France 3 Provence-Alpes-Côte d'Azur"],
      [7, 'Arte'],
      [28, 'Paris Première'],
      [939, 'Télé Bocal'],
      [940, 'TV78'],
    ])
  })

  test('leaves out a channel without stream, outside the subscription or not in the bouquet', () => {
    const names = channels.map((channel) => channel.name)
    expect(names).not.toContain('TF1')
    expect(names).not.toContain('Echorouk News')
    expect(names).not.toContain('CANAL+Ligue 1 Uber Eats')
  })

  test('picks the best rtsp stream: HD, then auto, then SD, then LD', () => {
    const byName = new Map(channels.map((channel) => [channel.name, channel.upstream]))
    expect(byName.get('France 2')).toEqual({ url: rtsp(201, 'hd') })
    expect(byName.get('TV78')?.url).toStartWith('rtsp://mafreebox.freebox.fr/fbxtv_pub/stream?')
    expect(byName.get('Télé Bocal')?.url).toStartWith('rtsp://')
  })

  test('keys on the uuid, which is also the guide key; one group; logos on the box', () => {
    expect(channels[0]).toEqual({
      key: 'uuid-webtv-201',
      name: 'France 2',
      number: 2,
      group: FREEBOX_GROUP,
      logoUrl:
        'http://mafreebox.freebox.fr/api/latest/tv/img/channels/logos68x60/uuid-webtv-201.png',
      upstream: { url: rtsp(201, 'hd') },
      guideKey: 'uuid-webtv-201',
    })
  })
})

describe('bestRtspOf', () => {
  const stream = (quality: string, url: string | undefined) => ({
    type: 'iptv',
    quality,
    ...(url === undefined ? {} : { rtsp: url }),
    hls: 'http://mafreebox.freebox.fr:8765/service/1/auto/master.m3u8',
  })

  test('HD first, then auto, then SD, then LD, then any other', () => {
    expect(
      bestRtspOf([
        stream('ld', rtsp(1, 'ld')),
        stream('auto', rtsp(1)),
        stream('sd', rtsp(1, 'sd')),
      ]),
    ).toBe(rtsp(1))
    expect(bestRtspOf([stream('auto', rtsp(1)), stream('hd', rtsp(1, 'hd'))])).toBe(rtsp(1, 'hd'))
    expect(bestRtspOf([stream('ld', rtsp(1, 'ld')), stream('sd', rtsp(1, 'sd'))])).toBe(
      rtsp(1, 'sd'),
    )
    expect(bestRtspOf([stream('uhd', rtsp(1, 'uhd')), stream('ld', rtsp(1, 'ld'))])).toBe(
      rtsp(1, 'ld'),
    )
    expect(bestRtspOf([stream('uhd', rtsp(1, 'uhd'))])).toBe(rtsp(1, 'uhd'))
  })

  test('only rtsp URLs count', () => {
    expect(bestRtspOf([stream('hd', undefined), stream('sd', rtsp(1, 'sd'))])).toBe(rtsp(1, 'sd'))
    expect(bestRtspOf([stream('hd', 'http://mafreebox.freebox.fr/stream')])).toBeUndefined()
    expect(bestRtspOf([{ quality: 'hd', rtsp: 42 }, 'junk'])).toBeUndefined()
    expect(bestRtspOf([])).toBeUndefined()
  })
})

describe('freeboxChannelsOf', () => {
  const channel = (uuid: string, extra: Record<string, unknown> = {}) => ({
    uuid,
    name: `  Channel   ${uuid} `,
    short_name: uuid,
    available: true,
    has_service: true,
    has_abo: false,
    logo_url: `/api/latest/tv/img/channels/logos68x60/${uuid}.png`,
    ...extra,
  })
  const entry = (uuid: string, number: number, extra: Record<string, unknown> = {}) => ({
    uuid,
    number,
    sub_number: 0,
    available: true,
    pub_service: true,
    streams: [{ type: 'iptv', quality: 'auto', rtsp: rtsp(number), hls: 'x' }],
    ...extra,
  })

  test('a uuid at several numbers takes its lowest number, then sub-number', () => {
    const listed = freeboxChannelsOf({
      address: 'http://192.168.1.254:80/',
      channels: { a: channel('a'), b: channel('b') },
      bouquet: [
        entry('a', 925),
        entry('b', 3, { sub_number: 2 }),
        entry('a', 3, { sub_number: 21 }),
      ],
    })
    expect(listed.map((c) => [c.key, c.number, c.upstream.url])).toEqual([
      ['b', 3, rtsp(3)],
      ['a', 3, rtsp(3)],
    ])
    expect(listed[0]?.name).toBe('Channel b')
    expect(listed[0]?.logoUrl).toBe(
      'http://192.168.1.254/api/latest/tv/img/channels/logos68x60/b.png',
    )
  })

  test('skips entries of another shape, keeps the others', () => {
    const listed = freeboxChannelsOf({
      address,
      channels: {
        a: channel('a'),
        bad: { uuid: 3 },
        c: channel('c', { logo_url: 'javascript:x' }),
      },
      bouquet: [entry('a', 1), { uuid: 'c' }, entry('c', 0), 'junk', entry('missing', 4)],
    })
    expect(listed.map((c) => c.key)).toEqual(['c', 'a'])
    expect(listed[0]).not.toHaveProperty('number')
    expect(listed[0]).not.toHaveProperty('logoUrl')
  })

  test('a logo is kept only on the box itself', () => {
    const logos = (logoUrl: string) =>
      freeboxChannelsOf({
        address: 'http://192.168.1.254:8080',
        channels: { a: channel('a', { logo_url: logoUrl }) },
        bouquet: [entry('a', 1)],
      })[0]?.logoUrl
    expect(logos('/logos/a.png')).toBe('http://192.168.1.254:8080/logos/a.png')
    expect(logos('http://192.168.1.254:8080/logos/a.png')).toBe(
      'http://192.168.1.254:8080/logos/a.png',
    )
    for (const elsewhere of [
      'http://evil.example/a.png',
      '//evil.example/a.png',
      'http://192.168.1.254/a.png',
      'https://192.168.1.254:8080/a.png',
      'http://127.0.0.1:8080/a.png',
      'file:///etc/passwd',
    ])
      expect(logos(elsewhere)).toBeUndefined()
  })

  test('answers of another shape give no channel', () => {
    expect(freeboxChannelsOf({ address, channels: [], bouquet: {} })).toEqual([])
  })
})
