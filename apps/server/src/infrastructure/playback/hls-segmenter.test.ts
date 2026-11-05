import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { generateVideo, hasFfmpeg } from '../../../test/support/media.ts'
import { planFixedSegments, segmentFileName } from '../../core/playback/hls-playlist.ts'
import type { HlsJob, HlsSegmenter } from '../../core/playback/ports.ts'
import { createFfprobe } from './ffprobe.ts'
import {
  createHlsSegmenter,
  fallsBackToSoftware,
  nextPreset,
  presetKey,
  wantsVaapi,
} from './hls-segmenter.ts'

const media = createTempDir('projo-segmenter-media-')
const files: Record<string, string> = {}
const ffprobe = createFfprobe()

beforeAll(async () => {
  if (!hasFfmpeg()) return
  files['long'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'aac',
    durationS: 40,
  })
  const tail = join(media.path, 'audio-tail.mkv')
  const proc = Bun.spawn({
    cmd: [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-t',
      '10',
      '-i',
      'testsrc=size=160x90:rate=24',
      '-f',
      'lavfi',
      '-t',
      '14',
      '-i',
      'sine=frequency=440:sample_rate=48000',
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
      tail,
    ],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
  if (code !== 0) throw new Error(`ffmpeg failed: ${stderr}`)
  files['tail'] = tail
})
afterAll(() => media.cleanup())

let cache: ReturnType<typeof createTempDir> | undefined
let segmenter: HlsSegmenter | undefined
afterEach(async () => {
  await segmenter?.stopAll()
  cache?.cleanup()
  segmenter = undefined
})

const newSegmenter = (options: {
  keepBehind?: number
  bufferAhead?: number
  waitMs: number
  presets?: string
}) => {
  const dir = createTempDir('projo-segmenter-')
  if (options.presets !== undefined)
    writeFileSync(join(dir.path, 'x264-presets.json'), options.presets)
  const { logger, lines } = createCapturingLogger()
  const created = createHlsSegmenter({
    transcodeDir: dir.path,
    logger,
    waitTimeoutMs: options.waitMs,
    ...(options.keepBehind === undefined ? {} : { keepBehind: options.keepBehind }),
    ...(options.bufferAhead === undefined ? {} : { bufferAhead: options.bufferAhead }),
  })
  cache = dir
  segmenter = created
  const runsStarted = () => lines.filter((line) => line.message === 'ffmpeg HLS run started')
  return { segmenter: created, dir: dir.path, runsStarted, lines }
}

const probeOf = async (path: string) => {
  const probe = await ffprobe.probe(path)
  if (!probe.ok) throw new Error(probe.error.message)
  return probe.value
}

const jobFor = async (sessionId: string, path: string, durationS?: number): Promise<HlsJob> => {
  const probe = await probeOf(path)
  const video = probe.video[0]
  const audio = probe.audio[0]
  if (video === undefined || audio === undefined) throw new Error('streams missing')
  return {
    mode: 'hls_transcode',
    sessionId,
    sourcePath: path,
    segments: planFixedSegments(durationS ?? (probe.durationMs ?? 0) / 1000),
    video: { index: video.index, codec: video.codec },
    audio: { index: audio.index, delivery: 'aac' },
    audioDownmix: 'stereo',
    hwAccel: 'off',
    transcode: { quality: 'original' },
  }
}

describe.skipIf(!hasFfmpeg())('HLS segmenter run control (real ffmpeg)', () => {
  test('a tail past the last video frame: one run, then an error (no restart loop)', async () => {
    const probe = await probeOf(files['tail'] ?? '')
    expect(Math.round((probe.durationMs ?? 0) / 1000)).toBe(14)
    expect(probe.video[0]?.durationMs).toBe(10_000)

    const job = await jobFor('tail', files['tail'] ?? '')
    expect(job.segments).toHaveLength(7)
    const { segmenter, runsStarted } = newSegmenter({ waitMs: 10_000 })
    const startedAt = Date.now()
    expect(await segmenter.segment(job, 6)).toMatchObject({
      ok: false,
      error: { code: 'playback/segment_not_found' },
    })
    expect(runsStarted()).toHaveLength(1)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(await segmenter.segment(job, 6)).toMatchObject({ ok: false })
    expect(runsStarted()).toHaveLength(1)

    const planned = await jobFor('tail-video', files['tail'] ?? '', 10)
    expect(planned.segments).toHaveLength(5)
    expect((await segmenter.segment(planned, 4)).ok).toBe(true)
  })

  test('back to a segment deleted behind the player, same run: ffmpeg restarts there', async () => {
    const job = await jobFor('back', files['long'] ?? '')
    const { segmenter, dir, runsStarted } = newSegmenter({
      keepBehind: 1,
      bufferAhead: 1,
      waitMs: 6_000,
    })
    for (const which of [0, 1, 2, 3, 4]) {
      expect((await segmenter.segment(job, which)).ok).toBe(true)
    }
    expect(runsStarted()).toHaveLength(1)
    expect(existsSync(join(dir, 'back', segmentFileName(0)))).toBe(false)
    const again = await segmenter.segment(job, 0)
    expect(again.ok).toBe(true)
    expect(runsStarted()).toHaveLength(2)
  })

  test('an older request still waiting does not take the run back from the latest one', async () => {
    const job = await jobFor('pingpong', files['long'] ?? '')
    const { segmenter, runsStarted } = newSegmenter({ bufferAhead: 1, waitMs: 3_000 })
    const older = segmenter.segment(job, 8)
    const latest = await segmenter.segment(job, 0)
    expect(latest.ok).toBe(true)
    expect(await older).toMatchObject({ ok: false, error: { code: 'playback/segment_timeout' } })
    expect(runsStarted()).toHaveLength(2)
  })

  test('a request aborted by the client gives up at once', async () => {
    const job = await jobFor('abort', files['long'] ?? '')
    const { segmenter, runsStarted } = newSegmenter({ bufferAhead: 1, waitMs: 10_000 })
    const controller = new AbortController()
    const older = segmenter.segment(job, 8, controller.signal)
    const latest = segmenter.segment(job, 0)
    const startedAt = Date.now()
    controller.abort()
    expect(await older).toMatchObject({ ok: false })
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    expect((await latest).ok).toBe(true)
    expect(runsStarted()).toHaveLength(2)
  })

  test('init asked first starts ffmpeg at the resume segment, not at 0', async () => {
    const job = { ...(await jobFor('resume', files['long'] ?? '')), startS: 21 }
    const { segmenter, runsStarted } = newSegmenter({ waitMs: 6_000 })
    expect((await segmenter.segment(job, 'init')).ok).toBe(true)
    expect((await segmenter.segment(job, 10)).ok).toBe(true)
    expect(runsStarted()).toMatchObject([{ fields: { fromSegment: 10 } }])
  })

  test('a segment is written to disk as it comes, a killed run leaves no partial file', async () => {
    const job = await jobFor('killed', files['long'] ?? '')
    const { segmenter, dir } = newSegmenter({ bufferAhead: 1, waitMs: 6_000 })
    expect((await segmenter.segment(job, 0)).ok).toBe(true)
    const temporaries = () =>
      readdirSync(join(dir, 'killed')).filter((name) => name.endsWith('.tmp'))
    const until = async (condition: () => boolean) => {
      for (let tries = 0; tries < 100 && !condition(); tries += 1) await Bun.sleep(20)
    }
    await until(() => temporaries().length > 0)
    expect(temporaries()).toHaveLength(1)
    await segmenter.stopAll()
    await until(() => temporaries().length === 0)
    expect(temporaries()).toEqual([])
  })
})

describe.skipIf(!hasFfmpeg())('x264 preset memory (real ffmpeg, §10.3)', () => {
  test('a session starts with the preset remembered for its kind of source', async () => {
    const job = await jobFor('preset', files['long'] ?? '')
    const { segmenter, runsStarted } = newSegmenter({
      waitMs: 6_000,
      presets: JSON.stringify({ [presetKey(job)]: 'ultrafast' }),
    })
    expect((await segmenter.segment(job, 0)).ok).toBe(true)
    expect(runsStarted()).toMatchObject([{ fields: { preset: 'ultrafast' } }])
    const other = { ...job, sessionId: 'preset-other', transcode: { quality: '480p' as const } }
    expect((await segmenter.segment(other, 0)).ok).toBe(true)
    expect(runsStarted()[1]).toMatchObject({ fields: { preset: 'veryfast' } })
  })

  test('the measured speed updates the memory for the next sessions, not the running one', async () => {
    const job = await jobFor('preset-speed', files['long'] ?? '')
    const { segmenter, dir, lines } = newSegmenter({
      waitMs: 6_000,
      presets: JSON.stringify({ [presetKey(job)]: 'ultrafast' }),
    })
    expect((await segmenter.segment(job, 0)).ok).toBe(true)
    const adapted = () =>
      lines.find((line) => line.message === 'x264 preset adapted to the server speed')
    for (let tries = 0; tries < 200 && adapted() === undefined; tries += 1) await Bun.sleep(25)
    expect(adapted()?.fields).toMatchObject({ from: 'ultrafast', to: 'veryfast' })
    expect(JSON.parse(readFileSync(join(dir, 'x264-presets.json'), 'utf8'))).toEqual({
      [presetKey(job)]: 'veryfast',
    })
  })

  test('an unreadable memory file is ignored', async () => {
    const job = await jobFor('preset-broken', files['long'] ?? '')
    const { segmenter, runsStarted } = newSegmenter({ waitMs: 6_000, presets: '{"x": "placebo"' })
    expect((await segmenter.segment(job, 0)).ok).toBe(true)
    expect(runsStarted()).toMatchObject([{ fields: { preset: 'veryfast' } }])
  })
})

describe('x264 preset choice (§10.3)', () => {
  test('ultrafast below 1.25× real time, back to veryfast above 3×', () => {
    expect(nextPreset('veryfast', 0.7)).toBe('ultrafast')
    expect(nextPreset('veryfast', 1.3)).toBe('veryfast')
    expect(nextPreset('ultrafast', 1.6)).toBe('ultrafast')
    expect(nextPreset('ultrafast', 3.5)).toBe('veryfast')
  })

  test('one memory per kind of source: codec, pixel format, height, quality, HDR, burn-in', () => {
    const job: HlsJob = {
      mode: 'hls_transcode',
      sessionId: 's',
      sourcePath: '/media/a.mkv',
      segments: planFixedSegments(8),
      video: { index: 0, codec: 'h264', height: 1080, pixelFormat: 'yuv420p10le' },
      audioDownmix: 'stereo',
      hwAccel: 'off',
      transcode: { quality: 'original' },
    }
    expect(presetKey(job)).toBe('h264:yuv420p10le:1080:original:sdr:plain')
  })
})

describe('VAAPI decision (§10.3)', () => {
  const transcode: HlsJob = {
    mode: 'hls_transcode',
    sessionId: 's',
    sourcePath: '/media/film.mkv',
    segments: planFixedSegments(8),
    video: { index: 0, codec: 'hevc' },
    audioDownmix: 'stereo',
    hwAccel: 'vaapi',
    transcode: { quality: '720p', dynamicRange: 'hdr' },
  }

  test('only a transcode without burn-in, when the admin turned VAAPI on', () => {
    expect(wantsVaapi(transcode)).toBe(true)
    expect(wantsVaapi({ ...transcode, hwAccel: 'off' })).toBe(false)
    expect(
      wantsVaapi({
        ...transcode,
        transcode: { quality: '720p', burnIn: { origin: 'embedded', streamIndex: 2 } },
      }),
    ).toBe(false)
    expect(wantsVaapi({ ...transcode, mode: 'hls_remux', keyframes: [0] })).toBe(false)
  })

  test('software retry: a failed VAAPI run, before any init.mp4 of the session', () => {
    const failed = { vaapi: true, exitCode: 1, killed: false, initExists: false }
    expect(fallsBackToSoftware(failed)).toBe(true)
    expect(fallsBackToSoftware({ ...failed, initExists: true })).toBe(false)
    expect(fallsBackToSoftware({ ...failed, killed: true })).toBe(false)
    expect(fallsBackToSoftware({ ...failed, exitCode: 0 })).toBe(false)
    expect(fallsBackToSoftware({ ...failed, vaapi: false })).toBe(false)
  })
})
