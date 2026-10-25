import { describe, expect, test } from 'bun:test'

import {
  aacBitrateKbps,
  audioArgs,
  remuxArgs,
  transcodeArgs,
  type TranscodeArgsInput,
} from './ffmpeg-args.ts'

/** The value following `flag` (first occurrence). */
const valueOf = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

/** Every value following `flag`. */
const valuesOf = (args: string[], flag: string): string[] =>
  args.flatMap((arg, i) => (arg === flag ? [args[i + 1] ?? ''] : []))

const base: TranscodeArgsInput = {
  sourcePath: '/media/Film (2020)/film.mkv',
  startS: 0,
  video: { index: 0, codec: 'hevc' },
  audio: { index: 1, delivery: 'aac', channels: 6 },
  quality: 'original',
  filters: { zscale: false, tonemap: false },
}

describe('audio (§10.2: settings.audio_downmix)', () => {
  test('stereo downmix at 192 kb/s by default, copy left alone', () => {
    expect(audioArgs({ index: 1, delivery: 'aac', channels: 6 })).toEqual([
      '-c:a',
      'aac',
      '-ac',
      '2',
      '-b:a',
      '192k',
    ])
    expect(audioArgs({ index: 1, delivery: 'copy', channels: 6 }, 'keep')).toEqual(['-c:a', 'copy'])
  })

  test('keep: the source channels, the bitrate following (8 channels at most)', () => {
    expect(audioArgs({ index: 1, delivery: 'aac', channels: 6 }, 'keep')).toEqual([
      '-c:a',
      'aac',
      '-b:a',
      '384k',
    ])
    expect(audioArgs({ index: 1, delivery: 'aac', channels: 2 }, 'keep')).toEqual([
      '-c:a',
      'aac',
      '-b:a',
      '192k',
    ])
    expect(audioArgs({ index: 1, delivery: 'aac', channels: 12 }, 'keep')).toEqual([
      '-c:a',
      'aac',
      '-ac',
      '8',
      '-b:a',
      '512k',
    ])
    expect(audioArgs({ index: 1, delivery: 'aac' }, 'keep')).toEqual([
      '-c:a',
      'aac',
      '-b:a',
      '192k',
    ])
    expect([1, 2, 6, 8].map(aacBitrateKbps)).toEqual([192, 192, 384, 512])
  })

  test('the remux applies the downmix setting to the audio it transcodes', () => {
    const args = remuxArgs({
      sourcePath: '/m/a.mkv',
      startS: 6,
      video: { index: 0, codec: 'h264' },
      audio: { index: 2, delivery: 'aac', channels: 6 },
      audioDownmix: 'keep',
    })
    expect(valueOf(args, '-b:a')).toBe('384k')
    expect(args).not.toContain('-ac')
    expect(valueOf(args, '-c:v')).toBe('copy')
    expect(valueOf(args, '-ss')).toBe('6.000000')
  })
})

describe('transcodeArgs (§10.2, §10.3)', () => {
  test('Original: libx264 veryfast CRF 21, source resolution (even), 8-bit 4:2:0', () => {
    const args = transcodeArgs(base)
    expect(valueOf(args, '-i')).toBe('file:/media/Film (2020)/film.mkv')
    expect(args).not.toContain('-ss')
    expect(valueOf(args, '-c:v')).toBe('libx264')
    expect(valueOf(args, '-preset')).toBe('veryfast')
    expect(valueOf(args, '-profile:v')).toBe('high')
    expect(valueOf(args, '-crf')).toBe('21')
    expect(args).not.toContain('-b:v')
    expect(valueOf(args, '-filter_complex')).toBe(
      '[0:0]scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]',
    )
    expect(valuesOf(args, '-map')).toEqual(['[v]', '0:1'])
    expect(valueOf(args, '-output_ts_offset')).toBe('10.000000')
    expect(args.slice(-1)).toEqual(['pipe:1'])
    expect(valueOf(args, '-movflags')).toContain('+frag_keyframe')
  })

  test('a forced IDR every 4 s and no other keyframe', () => {
    const args = transcodeArgs(base)
    expect(valueOf(args, '-force_key_frames')).toBe('expr:gte(t,n_forced*4)')
    expect(valueOf(args, '-forced-idr')).toBe('1')
    expect(valueOf(args, '-sc_threshold')).toBe('0')
    expect(valueOf(args, '-x264-params')).toBe('keyint=infinite')
  })

  test.each([
    ['1080p', 1920, 1080, '8000k', '16000k'],
    ['720p', 1280, 720, '4000k', '8000k'],
    ['480p', 854, 480, '1500k', '3000k'],
  ] as const)('%s: fits %ix%i, never upscaled, %s target', (quality, width, height, rate, buf) => {
    const args = transcodeArgs({ ...base, quality })
    expect(valueOf(args, '-filter_complex')).toBe(
      `[0:0]scale='min(iw,${width})':'min(ih,${height})':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p[v]`,
    )
    expect(valueOf(args, '-b:v')).toBe(rate)
    expect(valueOf(args, '-maxrate')).toBe(rate)
    expect(valueOf(args, '-bufsize')).toBe(buf)
    expect(args).not.toContain('-crf')
  })

  test('seek: accurate, 0.5 s of audio pre-roll, video trimmed to the segment start', () => {
    const args = transcodeArgs({ ...base, startS: 12 })
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'))
    expect(valueOf(args, '-ss')).toBe('11.500000')
    expect(args).not.toContain('-noaccurate_seek')
    expect(args).not.toContain('-copyts')
    expect(valueOf(args, '-filter_complex')).toBe(
      '[0:0]trim=start=0.500000,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]',
    )
    // Output timestamps = source timestamps + 10 s.
    expect(valueOf(args, '-output_ts_offset')).toBe('21.500000')
  })

  test('a seek closer to the start than the pre-roll reads from 0', () => {
    const args = transcodeArgs({ ...base, startS: 0.25 })
    expect(args).not.toContain('-ss')
    expect(valueOf(args, '-filter_complex')).toStartWith('[0:0]trim=start=0.250000,')
    expect(valueOf(args, '-output_ts_offset')).toBe('10.000000')
  })

  test('audio: AAC per the downmix setting, copied when the session says so, or none', () => {
    expect(valueOf(transcodeArgs(base), '-ac')).toBe('2')
    expect(valueOf(transcodeArgs({ ...base, audioDownmix: 'keep' }), '-b:a')).toBe('384k')
    const copied = transcodeArgs({ ...base, audio: { index: 3, delivery: 'copy' } })
    expect(valueOf(copied, '-c:a')).toBe('copy')
    expect(valuesOf(copied, '-map')).toEqual(['[v]', '0:3'])
    const silent = transcodeArgs({
      sourcePath: base.sourcePath,
      startS: 0,
      video: base.video,
      quality: 'original',
      filters: base.filters,
    })
    expect(valuesOf(silent, '-map')).toEqual(['[v]'])
    expect(silent).not.toContain('-c:a')
  })

  test('HDR / Dolby Vision: tonemapped to BT.709 when zscale and tonemap exist', () => {
    const args = transcodeArgs({
      ...base,
      video: { index: 0, codec: 'hevc', dynamicRange: 'hdr' },
      filters: { zscale: true, tonemap: true },
    })
    expect(valueOf(args, '-filter_complex')).toBe(
      '[0:0]zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p[v]',
    )
    expect(valueOf(args, '-color_trc')).toBe('bt709')
    const dv = transcodeArgs({
      ...base,
      video: { index: 0, codec: 'hevc', dynamicRange: 'dv' },
      filters: { zscale: true, tonemap: true },
    })
    expect(valueOf(dv, '-filter_complex')).toContain('tonemap=tonemap=hable')
  })

  test('HDR without zscale: plain 8-bit conversion; SDR never tonemapped', () => {
    const hdr = transcodeArgs({
      ...base,
      video: { index: 0, codec: 'hevc', dynamicRange: 'hdr' },
      filters: { zscale: false, tonemap: true },
    })
    expect(valueOf(hdr, '-filter_complex')).not.toContain('zscale')
    expect(hdr).not.toContain('-color_trc')
    const sdr = transcodeArgs({
      ...base,
      video: { index: 0, codec: 'hevc', dynamicRange: 'sdr' },
      filters: { zscale: true, tonemap: true },
    })
    expect(valueOf(sdr, '-filter_complex')).not.toContain('tonemap')
  })

  test('hwAccel is accepted; v1 encodes in software whatever its value', () => {
    expect(transcodeArgs({ ...base, hwAccel: 'vaapi' })).toEqual(transcodeArgs(base))
    expect(transcodeArgs({ ...base, hwAccel: 'qsv' })).toEqual(transcodeArgs(base))
  })
})

describe('burn-in of bitmap subtitles (§10.4)', () => {
  test('embedded track: overlay at the source resolution, then the scaling', () => {
    const args = transcodeArgs({
      ...base,
      quality: '720p',
      startS: 8,
      burnIn: { origin: 'embedded', streamIndex: 4 },
    })
    expect(valuesOf(args, '-i')).toHaveLength(1)
    expect(valueOf(args, '-filter_complex')).toBe(
      [
        '[0:0]trim=start=0.500000[base]',
        '[0:4][base]scale2ref=w=main_w:h=main_h[subs][video]',
        "[video][subs]overlay=eof_action=pass,scale='min(iw,1280)':'min(ih,720)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p[v]",
      ].join(';'),
    )
    expect(args).toContain('-sn')
  })

  test('embedded track with HDR tonemapping: the subtitles are drawn after it', () => {
    const graph = valueOf(
      transcodeArgs({
        ...base,
        video: { index: 0, codec: 'hevc', dynamicRange: 'hdr' },
        filters: { zscale: true, tonemap: true },
        burnIn: { origin: 'embedded', streamIndex: 2 },
      }),
      '-filter_complex',
    )
    expect(graph?.split(';')[0]).toStartWith('[0:0]zscale=t=linear')
    expect(graph?.split(';')[0]).toEndWith('[base]')
    expect(graph?.split(';')[2]).toStartWith('[video][subs]overlay')
  })

  test('external .sup: second input on its own timestamps, shifted like the video', () => {
    const args = transcodeArgs({
      ...base,
      startS: 16,
      burnIn: { origin: 'external', path: '/media/film.fr.sup', format: 'pgs' },
    })
    const second = args.lastIndexOf('-i')
    expect(args[second + 1]).toBe('file:/media/film.fr.sup')
    expect(args.slice(args.indexOf('file:/media/Film (2020)/film.mkv') + 1, second)).toEqual([
      '-seek_timestamp',
      '1',
      '-itsoffset',
      '-15.500000',
      '-f',
      'sup',
    ])
    expect(valueOf(args, '-filter_complex')).toContain('[1:0][base]scale2ref')
  })

  test('external VobSub: the .idx, read by the vobsub demuxer; no shift from the start', () => {
    const args = transcodeArgs({
      ...base,
      burnIn: { origin: 'external', path: '/media/film.en.idx', format: 'vobsub' },
    })
    const second = args.lastIndexOf('-i')
    expect(args.slice(second - 4, second + 2)).toEqual([
      '-seek_timestamp',
      '1',
      '-f',
      'vobsub',
      '-i',
      'file:/media/film.en.idx',
    ])
    expect(valueOf(args, '-filter_complex')).toStartWith('[0:0]null[base];[1:0][base]scale2ref')
  })
})
