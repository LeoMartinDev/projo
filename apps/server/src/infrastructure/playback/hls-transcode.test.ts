import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { type BitmapCue, writePgs } from '../../../test/support/bitmap-subtitles.ts'
import { createTempDir } from '../../../test/support/database.ts'
import { readTrackRun } from '../../../test/support/fmp4-timeline.ts'
import { createCapturingLogger, silentLogger } from '../../../test/support/logger.ts'
import {
  audioDelayS,
  decodesCleanly,
  ffprobeJson,
  generateVideo,
  hasFfmpeg,
} from '../../../test/support/media.ts'
import { planFixedSegments, planTranscodeSegments } from '../../core/playback/hls-playlist.ts'
import type {
  BurnInSubtitle,
  HlsJob,
  HlsSegmenter,
  HlsTranscode,
} from '../../core/playback/ports.ts'
import { outputTimestampOffsetS, transcodePrerollS } from './ffmpeg-args.ts'
import { createFfprobe } from './ffprobe.ts'
import { createBoxSplitter, fragmentStartTicks, readTracks } from './fmp4.ts'
import { createHlsSegmenter, detectFfmpegFilters } from './hls-segmenter.ts'

const media = createTempDir('projo-transcode-media-')
const files: Record<string, string> = {}
const ffprobe = createFfprobe()

const canvas = { width: 160, height: 90 }
const box = { x: 40, y: 50, width: 80, height: 20 }
const cues: BitmapCue[] = [
  { startS: 1, endS: 3, ...box },
  { startS: 9, endS: 11, ...box },
  { startS: 13, endS: 19, ...box },
]

const ffmpeg = async (args: string[]): Promise<void> => {
  const proc = Bun.spawn({
    cmd: ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr}`)
}

beforeAll(async () => {
  if (!hasFfmpeg()) return
  files['h264'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'aac',
    durationS: 22,
  })
  files['longGop'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'aac',
    durationS: 22,
    gopFrames: 120,
  })
  files['hevc10'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'hevc',
    audio: 'ac3',
    durationS: 14,
    pixelFormat: 'yuv420p10le',
  })
  files['hdr'] = join(media.path, 'hdr.mkv')
  await ffmpeg([
    '-i',
    files['hevc10'],
    '-map',
    '0',
    '-c',
    'copy',
    '-bsf:v',
    'hevc_metadata=colour_primaries=9:transfer_characteristics=16:matrix_coefficients=9',
    files['hdr'],
  ])
  const black = join(media.path, 'black.mkv')
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    `color=c=black:size=${canvas.width}x${canvas.height}:rate=24`,
    '-itsoffset',
    String(audioDelayS),
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '22',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '48',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    black,
  ])
  files['black'] = black
  files['sup'] = writePgs(media.path, 'black.sup', canvas, cues)
  files['blackPgs'] = join(media.path, 'black-pgs.mkv')
  await ffmpeg([
    '-i',
    black,
    '-i',
    files['sup'],
    '-map',
    '0',
    '-map',
    '1',
    '-c',
    'copy',
    '-copyts',
    files['blackPgs'],
  ])
  files['blackDvd'] = join(media.path, 'black-dvd.mkv')
  await ffmpeg([
    '-i',
    files['blackPgs'],
    '-map',
    '0',
    '-c',
    'copy',
    '-c:s',
    'dvdsub',
    '-copyts',
    files['blackDvd'],
  ])
})
afterAll(() => media.cleanup())

let cache: ReturnType<typeof createTempDir> | undefined
let segmenter: HlsSegmenter | undefined
afterEach(async () => {
  await segmenter?.stopAll()
  cache?.cleanup()
  segmenter = undefined
})
const newSegmenter = (deps: Partial<Parameters<typeof createHlsSegmenter>[0]> = {}) => {
  const dir = createTempDir('projo-transcode-')
  const created = createHlsSegmenter({ transcodeDir: dir.path, logger: silentLogger, ...deps })
  cache = dir
  segmenter = created
  return { segmenter: created, dir: dir.path }
}

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

const jobFor = async (
  sessionId: string,
  path: string,
  transcode: Partial<HlsTranscode> = {},
): Promise<HlsJob> => {
  const probe = unwrap(await ffprobe.probe(path))
  const video = probe.video[0]
  const audio = probe.audio[0]
  if (video === undefined || audio === undefined) throw new Error('streams missing')
  return {
    mode: 'hls_transcode',
    sessionId,
    sourcePath: path,
    segments: planFixedSegments((probe.durationMs ?? 0) / 1000),
    video: { index: video.index, codec: video.codec },
    audio: { index: audio.index, delivery: 'aac' },
    audioDownmix: 'stereo',
    hwAccel: 'off',
    transcode: { quality: 'original', ...transcode },
  }
}

const glue = (dir: string, name: string, parts: string[]): string => {
  const out = join(dir, name)
  writeFileSync(out, Buffer.concat(parts.map((part) => readFileSync(part))))
  return out
}

const tracksOf = (init: string) => {
  const [moov] = createBoxSplitter()
    .push(new Uint8Array(readFileSync(init)))
    .filter((entry) => entry.type === 'moov')
  const tracks = readTracks(moov?.bytes ?? new Uint8Array())
  const video = tracks.find((t) => t.handler === 'vide')
  const audio = tracks.find((t) => t.handler === 'soun')
  if (video === undefined) throw new Error('no video track')
  return { video, audio }
}

const moofs = (segment: string) =>
  createBoxSplitter()
    .push(new Uint8Array(readFileSync(segment)))
    .filter((entry) => entry.type === 'moof')

const seconds = (ticks: number, timescale: number): number =>
  Math.round((ticks / timescale - outputTimestampOffsetS) * 1000) / 1000

const fragmentStarts = (init: string, segment: string): number[] => {
  const { video } = tracksOf(init)
  return moofs(segment).map((entry) =>
    seconds(fragmentStartTicks(entry.bytes, video.trackId) ?? NaN, video.timescale),
  )
}

const timeline = (init: string, segments: string[]) => {
  const { video, audio } = tracksOf(init)
  const frames: number[] = []
  const audioFragments: [number, number][] = []
  for (const segment of segments) {
    for (const moof of moofs(segment)) {
      const videoRun = readTrackRun(moof.bytes, video.trackId)
      let decode = videoRun?.baseDecodeTicks ?? 0
      for (const sample of videoRun?.samples ?? []) {
        frames.push(
          (decode + sample.compositionOffsetTicks) / video.timescale - outputTimestampOffsetS,
        )
        decode += sample.durationTicks
      }
      const audioRun = audio === undefined ? undefined : readTrackRun(moof.bytes, audio.trackId)
      if (audio !== undefined && audioRun !== undefined && audioRun.samples.length > 0) {
        const total = audioRun.samples.reduce((sum, sample) => sum + sample.durationTicks, 0)
        audioFragments.push([
          audioRun.baseDecodeTicks / audio.timescale - outputTimestampOffsetS,
          (audioRun.baseDecodeTicks + total) / audio.timescale - outputTimestampOffsetS,
        ])
      }
    }
  }
  return { frames: frames.sort((a, b) => a - b), audioFragments }
}

const expectContinuous = (init: string, segments: string[], fromS: number, toS: number) => {
  const { frames, audioFragments } = timeline(init, segments)
  expect(frames[0]).toBeCloseTo(fromS, 3)
  expect(frames[frames.length - 1]).toBeCloseTo(toS - 1 / 24, 2)
  for (let i = 1; i < frames.length; i += 1) {
    expect((frames[i] ?? 0) - (frames[i - 1] ?? 0)).toBeCloseTo(1 / 24, 3)
  }
  const audioStart = audioFragments[0]?.[0] ?? NaN
  expect(audioStart).toBeGreaterThan(fromS - transcodePrerollS - 0.05)
  expect(audioStart).toBeLessThan(fromS + 0.05)
  for (let i = 1; i < audioFragments.length; i += 1) {
    const gap = (audioFragments[i]?.[0] ?? 0) - (audioFragments[i - 1]?.[1] ?? 0)
    expect(gap).toBeLessThan(1024 / 48_000 + 1e-3)
    expect(gap).toBeGreaterThan(-0.6)
  }
}

const boxLuma = async (
  init: string,
  segments: string[],
  glued: string,
): Promise<{ t: number; luma: number }[]> => {
  const proc = Bun.spawn({
    cmd: [
      'ffmpeg',
      '-v',
      'error',
      '-i',
      glued,
      '-vf',
      `crop=${box.width}:${box.height}:${box.x}:${box.y}`,
      '-fps_mode',
      'passthrough',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-',
    ],
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const bytes = new Uint8Array(await new Response(proc.stdout).arrayBuffer())
  const { frames } = timeline(init, segments)
  const size = box.width * box.height
  expect(bytes.length).toBe(frames.length * size)
  return frames.map((time, i) => {
    let sum = 0
    for (let j = 0; j < size; j += 1) sum += bytes[i * size + j] ?? 0
    return { t: time, luma: sum / size }
  })
}

const litAt = (frames: { t: number; luma: number }[], timeS: number): boolean => {
  const frame = frames.reduce((best, f) =>
    Math.abs(f.t - timeS) < Math.abs(best.t - timeS) ? f : best,
  )
  if (Math.abs(frame.t - timeS) > 0.1) throw new Error(`no frame near ${timeS}`)
  return frame.luma > 128
}

describe.skipIf(!hasFfmpeg())('HLS transcode segmenter (real ffmpeg)', () => {
  test('H.264 → H.264: init + segment playable, one fragment per 2 s segment', async () => {
    const job = await jobFor('t-h264', files['h264'] ?? '', { quality: '480p' })
    const { segmenter, dir } = newSegmenter()
    const init = unwrap(await segmenter.segment(job, 'init'))
    const first = unwrap(await segmenter.segment(job, 0))
    const glued = glue(dir, 'first.mp4', [init, first])
    const probe = await ffprobeJson(glued)
    expect(probe.streams.map((s) => [s.codec_type, s.codec_name])).toEqual([
      ['video', 'h264'],
      ['audio', 'aac'],
    ])
    const video = (probe.streams[0] ?? {}) as { width?: number; height?: number }
    expect([video.width, video.height]).toEqual([160, 90])
    expect(await decodesCleanly(glued)).toBe(true)
    expect(fragmentStarts(init, first)).toEqual([0])
  })

  test('seek, then back to the start: segments of both runs chain without hole or jump', async () => {
    const job = await jobFor('t-seek', files['h264'] ?? '')
    expect(job.segments.map((s) => s.startS)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    const { segmenter, dir } = newSegmenter()
    const sixth = unwrap(await segmenter.segment(job, 6))
    const init = unwrap(await segmenter.segment(job, 'init'))
    expect(fragmentStarts(init, sixth)).toEqual([12])
    const all: string[] = []
    for (const which of job.segments.map((segment) => segment.index)) {
      all.push(which === 6 ? sixth : unwrap(await segmenter.segment(job, which)))
    }
    expect(all.map((segment) => fragmentStarts(init, segment))).toEqual(
      job.segments.map((segment) => [segment.startS]),
    )
    const glued = glue(dir, 'all.mp4', [init, ...all])
    expect(await decodesCleanly(glued)).toBe(true)
    expectContinuous(init, all, 0, 22)
  })

  test('HEVC 10-bit → H.264 8-bit 4:2:0, right timeline after a seek', async () => {
    const job = await jobFor('t-hevc10', files['hevc10'] ?? '', { quality: '720p' })
    const { segmenter, dir } = newSegmenter()
    const four = unwrap(await segmenter.segment(job, 4))
    const init = unwrap(await segmenter.segment(job, 'init'))
    expect(fragmentStarts(init, four)).toEqual([8])
    const two = unwrap(await segmenter.segment(job, 2))
    const three = unwrap(await segmenter.segment(job, 3))
    const glued = glue(dir, 'hevc.mp4', [init, two, three, four])
    const probe = (await ffprobeJson(glued)) as unknown as {
      streams: { codec_name: string; pix_fmt?: string; profile?: string; channels?: number }[]
    }
    expect(probe.streams[0]).toMatchObject({
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      profile: 'High',
    })
    expect(probe.streams[1]).toMatchObject({ codec_name: 'aac', channels: 2 })
    expect(await decodesCleanly(glued)).toBe(true)
    expectContinuous(init, [two, three, four], 4, 10)
  })
})

describe.skipIf(!hasFfmpeg())('transcode cut on the source keyframes (real ffmpeg, §10.3)', () => {
  const alignedJob = async (sessionId: string) => {
    const job = await jobFor(sessionId, files['longGop'] ?? '')
    return { ...job, segments: planTranscodeSegments(22, [0, 5, 10, 15, 20]) }
  }

  test('a seek on a keyframe, then the whole file: every segment in place, no hole', async () => {
    const job = await alignedJob('k-seek')
    expect(job.segments.map((s) => [s.startS, s.onKeyframe === true])).toEqual([
      [0, true],
      [2.5, false],
      [5, true],
      [7.5, false],
      [10, true],
      [12.5, false],
      [15, true],
      [17.5, false],
      [20, true],
    ])
    const { segmenter, dir } = newSegmenter()
    const fourth = unwrap(await segmenter.segment(job, 4))
    const init = unwrap(await segmenter.segment(job, 'init'))
    expect(fragmentStarts(init, fourth)).toEqual([10])
    const all: string[] = []
    for (const which of job.segments.map((segment) => segment.index)) {
      all.push(which === 4 ? fourth : unwrap(await segmenter.segment(job, which)))
    }
    expect(all.map((segment) => fragmentStarts(init, segment))).toEqual(
      job.segments.map((segment) => [segment.startS]),
    )
    const glued = glue(dir, 'aligned.mp4', [init, ...all])
    expect(await decodesCleanly(glued)).toBe(true)
    expectContinuous(init, all, 0, 22)
  })

  test('a seek between two keyframes, then the following pieces', async () => {
    const job = await alignedJob('k-mid')
    const { segmenter, dir } = newSegmenter()
    const fifth = unwrap(await segmenter.segment(job, 5))
    const init = unwrap(await segmenter.segment(job, 'init'))
    expect(fragmentStarts(init, fifth)).toEqual([12.5])
    const sixth = unwrap(await segmenter.segment(job, 6))
    const seventh = unwrap(await segmenter.segment(job, 7))
    expect(await decodesCleanly(glue(dir, 'mid.mp4', [init, fifth, sixth, seventh]))).toBe(true)
    expectContinuous(init, [fifth, sixth, seventh], 12.5, 20)
  })
})

describe.skipIf(!hasFfmpeg())('burn-in of bitmap subtitles (real ffmpeg, §10.4)', () => {
  const burnt = async (
    sessionId: string,
    path: string,
    burnIn: BurnInSubtitle,
    segment: number,
  ) => {
    const job = await jobFor(sessionId, path, { burnIn, quality: '480p' })
    const { segmenter, dir } = newSegmenter()
    const produced = unwrap(await segmenter.segment(job, segment))
    const init = unwrap(await segmenter.segment(job, 'init'))
    const next = unwrap(await segmenter.segment(job, segment + 1))
    const glued = glue(dir, `${sessionId}.mp4`, [init, produced, next])
    expect(await decodesCleanly(glued)).toBe(true)
    return boxLuma(init, [produced, next], glued)
  }

  test('embedded PGS, after a seek: the cues show at their own time', async () => {
    const frames = await burnt(
      'b-pgs',
      files['blackPgs'] ?? '',
      { origin: 'embedded', streamIndex: 2 },
      4,
    )
    expect(frames[0]?.t).toBeCloseTo(8, 2)
    expect([8.5, 9.5, 10.5, 11.5].map((t) => litAt(frames, t))).toEqual([false, true, true, false])
  })

  test('embedded DVD subtitles (VobSub), after a seek', async () => {
    const frames = await burnt(
      'b-dvd',
      files['blackDvd'] ?? '',
      { origin: 'embedded', streamIndex: 2 },
      4,
    )
    expect([8.5, 9.5, 10.5].map((t) => litAt(frames, t))).toEqual([false, true, true])
  })

  test('external .sup, after a seek: the cue already on screen at the seek point shows too', async () => {
    const sup = { origin: 'external', path: files['sup'] ?? '', format: 'pgs' } as const
    const fromSixteen = await burnt('b-sup', files['black'] ?? '', sup, 8)
    expect(fromSixteen[0]?.t).toBeCloseTo(16, 2)
    expect([16.2, 17.5].map((t) => litAt(fromSixteen, t))).toEqual([true, true])
    const fromEight = await burnt('b-sup-2', files['black'] ?? '', sup, 4)
    expect([8.5, 9.5, 11.5].map((t) => litAt(fromEight, t))).toEqual([false, true, false])
  })
})

const canTonemap = hasFfmpeg() && Object.values(detectFfmpegFilters()).every(Boolean)

describe.skipIf(!canTonemap)('HDR → SDR tone mapping (real ffmpeg with zscale, §10.3)', () => {
  test('PQ HEVC 10-bit, detected HDR from the probe → H.264 8-bit tagged BT.709', async () => {
    const path = files['hdr'] ?? ''
    const probed = unwrap(await ffprobe.probe(path))
    expect(probed.video[0]?.dynamicRange).toBe('hdr')
    const job = await jobFor('t-hdr', path, { quality: '480p', dynamicRange: 'hdr' })
    const { segmenter, dir } = newSegmenter()
    const two = unwrap(await segmenter.segment(job, 2))
    const init = unwrap(await segmenter.segment(job, 'init'))
    const three = unwrap(await segmenter.segment(job, 3))
    const glued = glue(dir, 'hdr.mp4', [init, two, three])
    const probe = (await ffprobeJson(glued)) as unknown as {
      streams: Record<string, unknown>[]
    }
    expect(probe.streams[0]).toMatchObject({
      codec_name: 'h264',
      pix_fmt: 'yuv420p',
      color_transfer: 'bt709',
      color_primaries: 'bt709',
      color_space: 'bt709',
    })
    expect(await decodesCleanly(glued)).toBe(true)
    expectContinuous(init, [two, three], 4, 8)
  })
})

describe.skipIf(!hasFfmpeg())('VAAPI fallback to software (real ffmpeg, no GPU, §10.3)', () => {
  const vaapiWorld = () => {
    const { logger, lines } = createCapturingLogger()
    const notified: unknown[] = []
    const resolved: unknown[] = []
    const notifier = {
      notify: (input: unknown) => notified.push(input),
      resolve: (input: unknown) => resolved.push(input),
    }
    return { logger, lines, notifier, notified, resolved }
  }

  test('render node missing: software from the first run, the admin notified', async () => {
    const world = vaapiWorld()
    const job = { ...(await jobFor('v-missing', files['h264'] ?? '')), hwAccel: 'vaapi' as const }
    const { segmenter, dir } = newSegmenter({
      logger: world.logger,
      notifier: world.notifier,
      renderNode: join(media.path, 'renderD128'),
    })
    const init = unwrap(await segmenter.segment(job, 'init'))
    const zero = unwrap(await segmenter.segment(job, 0))
    expect(await decodesCleanly(glue(dir, 'missing.mp4', [init, zero]))).toBe(true)
    expect(world.notified).toEqual([
      {
        kind: 'playback/hw_accel_failed',
        severity: 'warning',
        key: 'vaapi',
        context: {
          reason: 'render_node_unavailable',
          renderNode: join(media.path, 'renderD128'),
          codec: 'h264',
        },
      },
    ])
    expect(
      world.lines.filter((line) => line.fields['code'] === 'playback/hw_accel_failed'),
    ).toEqual([expect.objectContaining({ level: 'warn' })])
  })

  test('a VAAPI run that fails before writing anything is retried with CPU decoding, then in software', async () => {
    const world = vaapiWorld()
    const fakeNode = join(media.path, 'fake-render-node')
    writeFileSync(fakeNode, '')
    const job = { ...(await jobFor('v-fails', files['h264'] ?? '')), hwAccel: 'vaapi' as const }
    const { segmenter, dir } = newSegmenter({
      logger: world.logger,
      notifier: world.notifier,
      renderNode: fakeNode,
    })
    const two = unwrap(await segmenter.segment(job, 2))
    const init = unwrap(await segmenter.segment(job, 'init'))
    expect(await decodesCleanly(glue(dir, 'fallback.mp4', [init, two]))).toBe(true)
    expect(fragmentStarts(init, two)).toEqual([4])
    expect(world.notified).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ reason: 'ffmpeg_failed' }) }),
    ])
    expect(world.resolved).toEqual([])
    expect(world.lines.filter((line) => line.level === 'error')).toEqual([])
    const runs = world.lines.filter((line) => line.message === 'ffmpeg HLS run started')
    expect(runs.map((line) => line.fields['acceleration'])).toEqual([
      'gpu',
      'gpu_encode',
      'software',
    ])
    expect(
      world.lines.filter((line) => line.fields['code'] === 'playback/hw_decode_unsupported'),
    ).toEqual([expect.objectContaining({ level: 'info' })])
  })
})
