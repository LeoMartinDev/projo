import { afterAll, beforeAll, expect, test } from 'bun:test'

import { type IptvServer, startIptvServer } from '../../../test/support/iptv-server.ts'
import { createFreeboxProvider } from './freebox/freebox-provider.ts'
import { isRtsp, liveInputArgs } from './live-args.ts'
import { createM3uProvider } from './m3u/m3u-provider.ts'
import { createTvSourceProvider } from './providers.ts'
import { createXtreamProvider } from './xtream/xtream-provider.ts'

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
})
afterAll(() => iptv.stop())

const xtreamSettings = () => ({
  kind: 'xtream' as const,
  serverUrl: iptv.url,
  username: 'projo-user',
  password: 's3cret/pass',
})

const provider = createTvSourceProvider({
  m3u: createM3uProvider(),
  xtream: createXtreamProvider(),
  freebox: createFreeboxProvider(),
})

test('each kind goes to its connector', async () => {
  const m3u = await provider.listChannels({
    settings: { kind: 'm3u', playlistUrl: iptv.at('/m3u/playlist.m3u') },
  })
  const freebox = await provider.listChannels({ settings: { kind: 'freebox', address: iptv.url } })
  const xtream = await provider.listChannels({ settings: xtreamSettings() })
  expect(m3u.ok && m3u.value.channels.some((channel) => channel.name === 'News Two')).toBe(true)
  expect(xtream.ok && xtream.value.channels[0]?.key).toBe('stream:103')
  expect(freebox.ok && freebox.value.channels[0]?.key).toBe('uuid-webtv-201')
  expect(
    provider.upstreamOf({
      settings: { kind: 'm3u', playlistUrl: iptv.at('/m3u/playlist.m3u'), userAgent: 'Box/1' },
      upstream: { url: 'http://p/1.ts' },
    }),
  ).toEqual({ url: 'http://p/1.ts', userAgent: 'Box/1' })
})

test("an Xtream channel's upstream gets the account's credentials when it opens (§29.2)", () => {
  expect(
    provider.upstreamOf({ settings: xtreamSettings(), upstream: { url: 'live/101.ts' } }),
  ).toEqual({
    url: `${iptv.url}/live/projo-user/s3cret%2Fpass/101.ts`,
    secrets: ['projo-user', 's3cret/pass'],
  })
  // Not an Xtream stream path: never opened, never a local path handed to ffmpeg.
  for (const url of ['live/../101.ts', '/etc/passwd', 'http://elsewhere/live/101.ts'])
    expect(provider.upstreamOf({ settings: xtreamSettings(), upstream: { url } })).toBeUndefined()
})

test("a Freebox channel's upstream takes the relay's RTSP path, TCP then UDP (§29.4)", async () => {
  const settings = { kind: 'freebox' as const, address: iptv.url }
  const listed = await provider.listChannels({ settings })
  if (!listed.ok) throw new Error(listed.error.message)
  const [channel] = listed.value.channels
  if (channel === undefined) throw new Error('no channel')
  const upstream = provider.upstreamOf({ settings, upstream: channel.upstream })
  if (upstream === undefined) throw new Error('no upstream')
  expect(isRtsp(upstream.url)).toBe(true)
  const url = 'rtsp://mafreebox.freebox.fr/fbxtv_pub/stream?namespace=1&service=201&flavour=hd'
  for (const transport of ['tcp', 'udp'] as const)
    expect(liveInputArgs(upstream, transport, 1_000_000)).toEqual([
      '-protocol_whitelist',
      'http,https,httpproxy,tls,tcp,udp,rtp,crypto',
      '-rtsp_transport',
      transport,
      '-timeout',
      '15000000',
      '-analyzeduration',
      '1000000',
      '-i',
      url,
    ])
})
