import { afterAll, beforeAll, expect, test } from 'bun:test'

import { type IptvServer, startIptvServer } from '../../../test/support/iptv-server.ts'
import { createFreeboxProvider } from './freebox/freebox-provider.ts'
import { isRtsp, liveInputArgs } from './live-args.ts'
import { createM3uProvider } from './m3u/m3u-provider.ts'
import { createTvSourceProvider } from './providers.ts'

let iptv: IptvServer
beforeAll(() => {
  iptv = startIptvServer()
})
afterAll(() => iptv.stop())

const provider = createTvSourceProvider({
  m3u: createM3uProvider(),
  freebox: createFreeboxProvider(),
})

test('each kind goes to its connector', async () => {
  const m3u = await provider.listChannels({
    settings: { kind: 'm3u', playlistUrl: iptv.at('/m3u/playlist.m3u') },
  })
  const freebox = await provider.listChannels({ settings: { kind: 'freebox', address: iptv.url } })
  expect(m3u.ok && m3u.value.channels.some((channel) => channel.name === 'News Two')).toBe(true)
  expect(freebox.ok && freebox.value.channels[0]?.key).toBe('uuid-webtv-201')
  expect(
    provider.upstreamOf({
      settings: { kind: 'm3u', playlistUrl: iptv.at('/m3u/playlist.m3u'), userAgent: 'Box/1' },
      upstream: { url: 'http://p/1.ts' },
    }),
  ).toEqual({ url: 'http://p/1.ts', userAgent: 'Box/1' })
})

test("a Freebox channel's upstream takes the relay's RTSP path, TCP then UDP (§29.4)", async () => {
  const settings = { kind: 'freebox' as const, address: iptv.url }
  const listed = await provider.listChannels({ settings })
  if (!listed.ok) throw new Error(listed.error.message)
  const [channel] = listed.value.channels
  if (channel === undefined) throw new Error('no channel')
  const upstream = provider.upstreamOf({ settings, upstream: channel.upstream })
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
