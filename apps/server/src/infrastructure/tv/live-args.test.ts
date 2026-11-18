import { describe, expect, test } from 'bun:test'

import {
  liveInputArgs,
  liveProbeArgs,
  liveProtocols,
  liveRelayArgs,
  maskUrls,
} from './live-args.ts'

const allowed = ['-protocol_whitelist', liveProtocols]

const spec = {
  channelId: 'c1',
  run: 3,
  upstream: { url: 'http://provider.test/live/1.ts?token=secret' },
  videoCodec: 'h264',
}

describe('ffmpeg arguments of the relay (§29.4)', () => {
  test('the upstream options go before the input, per scheme', () => {
    expect(
      liveInputArgs(
        {
          url: 'https://provider.test/1.ts',
          userAgent: 'ProviderPlayer/2.0',
          referrer: 'https://provider.test/portal',
        },
        undefined,
        1_000_000,
      ),
    ).toEqual([
      ...allowed,
      '-user_agent',
      'ProviderPlayer/2.0',
      '-referer',
      'https://provider.test/portal',
      '-rw_timeout',
      '15000000',
      '-analyzeduration',
      '1000000',
      '-i',
      'https://provider.test/1.ts',
    ])
    expect(liveInputArgs({ url: 'rtsp://box.lan/stream?id=1' }, 'udp', 1)).toEqual([
      ...allowed,
      '-rtsp_transport',
      'udp',
      '-timeout',
      '15000000',
      '-analyzeduration',
      '1',
      '-i',
      'rtsp://box.lan/stream?id=1',
    ])
    expect(liveInputArgs({ url: 'udp://@239.0.0.1:1234' }, undefined, 1)).toEqual([
      ...allowed,
      '-timeout',
      '15000000',
      '-analyzeduration',
      '1',
      '-i',
      'udp://@239.0.0.1:1234',
    ])
    expect(liveProbeArgs({ url: 'rtsp://box.lan/s' }, 'tcp')).toContain('tcp')
    // Never a local file, whatever an upstream's playlist refers to.
    expect(liveProtocols.split(',')).not.toContain('file')
    expect(liveProbeArgs({ url: 'http://provider.test/1.m3u8' }).slice(-8, -6)).toEqual(allowed)
  })

  test('video copied, AAC copied or other audio as stereo AAC, live HLS fMP4 of the run', () => {
    const copied = liveRelayArgs({ spec: { ...spec, audio: { index: 2, copy: true } }, dir: '/d' })
    expect(copied.join(' ')).toContain(
      '-map 0:v:0 -map 0:2 -c:v copy -c:a copy -bsf:a aac_adtstoasc',
    )
    expect(copied.slice(-15)).toEqual([
      '-f',
      'hls',
      '-hls_segment_type',
      'fmp4',
      '-hls_time',
      '2',
      '-hls_list_size',
      '20',
      '-hls_flags',
      'delete_segments+independent_segments',
      '-hls_fmp4_init_filename',
      'init-3.mp4',
      '-hls_segment_filename',
      '/d/seg-3-%05d.m4s',
      '/d/run-3.m3u8',
    ])

    const transcoded = liveRelayArgs({
      spec: { ...spec, videoCodec: 'hevc', audio: { index: 1, copy: false } },
      dir: '/data/100%',
    })
    expect(transcoded.join(' ')).toContain('-tag:v hvc1 -c:a aac -ac 2 -b:a 192k')
    expect(transcoded).toContain('/data/100%%/seg-3-%05d.m4s')
    expect(liveRelayArgs({ spec, dir: '/d' }).join(' ')).not.toContain('-c:a')
  })

  test('URLs in ffmpeg output are masked to their host', () => {
    expect(
      maskUrls(
        "[http @ 0x1] HTTP error 403 Forbidden\nhttp://user:pw@provider.test:8080/live/u/p/1.ts?token=secret: Server returned 403 Forbidden 'rtsp://box.lan/x?id=2'",
      ),
    ).toBe(
      "[http @ 0x1] HTTP error 403 Forbidden\nhttp://provider.test:8080/… Server returned 403 Forbidden 'rtsp://box.lan/…'",
    )
  })
})
