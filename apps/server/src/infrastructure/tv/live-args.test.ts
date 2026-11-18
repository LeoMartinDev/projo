import { describe, expect, test } from 'bun:test'

import {
  liveCompatArgs,
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

const compat = (fieldOrder?: string) => ({
  channelId: 'c1',
  run: 2,
  copyRun: 5,
  video: { codec: 'h264', ...(fieldOrder === undefined ? {} : { fieldOrder }) },
})
const dir = '/data/cache/live/c1-compat'
const at1080 = `'min(iw,1920)':'min(ih,1080)':force_original_aspect_ratio=decrease:force_divisible_by=2`

const after = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

describe('ffmpeg arguments of the compat rendition (§29.4)', () => {
  test('software: stdin only, deinterlaced when interlaced, at most 1080p, H.264 and AAC', () => {
    const args = liveCompatArgs({
      spec: compat('tt'),
      dir,
      acceleration: 'software',
      renderNode: '/dev/dri/renderD128',
    })
    expect(args.slice(args.indexOf('-f'), args.indexOf('-i') + 2)).toEqual([
      '-f',
      'mp4',
      '-i',
      'pipe:0',
    ])
    expect(args.join(' ')).not.toContain('://')
    expect(args.join(' ')).not.toContain('vaapi')
    expect(after(args, '-vf')).toBe(
      `bwdif=mode=send_frame:deint=interlaced,scale=${at1080},format=yuv420p`,
    )
    expect(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 8)).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-profile:v',
      'high',
      '-crf',
      '21',
    ])
    expect(after(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*2)')
    expect(after(args, '-c:a')).toBe('copy')
    expect(args.filter((arg) => arg === '-map')).toHaveLength(2)
    expect(args).toContain('0:a:0?')
    expect(args.slice(-5)).toEqual([
      '-hls_fmp4_init_filename',
      'init-2.mp4',
      '-hls_segment_filename',
      `${dir}/seg-2-%05d.m4s`,
      `${dir}/run-2.m3u8`,
    ])
    expect(after(args, '-hls_time')).toBe('2')
  })

  test('a progressive source is not deinterlaced', () => {
    for (const fieldOrder of [undefined, 'progressive', 'unknown']) {
      const args = liveCompatArgs({
        spec: compat(fieldOrder),
        dir,
        acceleration: 'software',
        renderNode: '/dev/dri/renderD128',
      })
      expect(after(args, '-vf')).toBe(`scale=${at1080},format=yuv420p`)
    }
  })

  test('VAAPI: decoded on the GPU or the CPU, deinterlaced and scaled on the GPU', () => {
    const gpu = liveCompatArgs({
      spec: compat('bb'),
      dir,
      acceleration: 'gpu',
      renderNode: '/dev/dri/renderD128',
    })
    expect(gpu.slice(4, 14)).toEqual([
      '-init_hw_device',
      'vaapi=va:/dev/dri/renderD128',
      '-filter_hw_device',
      'va',
      '-hwaccel',
      'vaapi',
      '-hwaccel_device',
      'va',
      '-hwaccel_output_format',
      'vaapi',
    ])
    expect(after(gpu, '-vf')).toBe(
      `format=nv12|vaapi,hwupload,deinterlace_vaapi,scale_vaapi=${at1080}:format=nv12`,
    )
    expect(gpu.slice(gpu.indexOf('-c:v'), gpu.indexOf('-c:v') + 8)).toEqual([
      '-c:v',
      'h264_vaapi',
      '-profile:v',
      'high',
      '-rc_mode',
      'CQP',
      '-qp',
      '21',
    ])
    const cpuDecoded = liveCompatArgs({
      spec: compat(),
      dir,
      acceleration: 'gpu_encode',
      renderNode: '/dev/dri/renderD128',
    })
    expect(cpuDecoded).not.toContain('-hwaccel')
    expect(cpuDecoded).toContain('-init_hw_device')
    expect(after(cpuDecoded, '-vf')).toBe(
      `format=nv12|vaapi,hwupload,scale_vaapi=${at1080}:format=nv12`,
    )
  })
})
