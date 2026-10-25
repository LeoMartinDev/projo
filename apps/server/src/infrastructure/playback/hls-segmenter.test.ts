import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { generateVideo, hasFfmpeg } from '../../../test/support/media.ts'
import { planFixedSegments, segmentFileName } from '../../core/playback/hls-playlist.ts'
import type { HlsJob, HlsSegmenter } from '../../core/playback/ports.ts'
import { createFfprobe } from './ffprobe.ts'
import { createHlsSegmenter } from './hls-segmenter.ts'

/**
 * §10.3 run control against the real ffmpeg: when a request waits, when it restarts ffmpeg, and
 * when it gives up (a tail with no video frame, a segment deleted behind the player, a request
 * the player abandoned).
 */

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
  // 10 s of video, 14 s of audio: the container lasts 14 s.
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

const newSegmenter = (options: { keepBehind?: number; bufferAhead?: number; waitMs: number }) => {
  const dir = createTempDir('projo-segmenter-')
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
  return { segmenter: created, dir: dir.path, runsStarted }
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
    // The probe knows where the video ends (Matroska `DURATION` tag).
    expect(probe.video[0]?.durationMs).toBe(10_000)

    // Planned on the container's duration: the 12–14 s segment holds no frame.
    const job = await jobFor('tail', files['tail'] ?? '')
    expect(job.segments).toHaveLength(4)
    const { segmenter, runsStarted } = newSegmenter({ waitMs: 10_000 })
    const startedAt = Date.now()
    expect(await segmenter.segment(job, 3)).toMatchObject({
      ok: false,
      error: { code: 'playback/segment_not_found' },
    })
    expect(runsStarted()).toHaveLength(1)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
    // The run that went to the end says so to later requests too: no new ffmpeg.
    expect(await segmenter.segment(job, 3)).toMatchObject({ ok: false })
    expect(runsStarted()).toHaveLength(1)

    // Planned on the video's end: every segment exists.
    const planned = await jobFor('tail-video', files['tail'] ?? '', 10)
    expect(planned.segments).toHaveLength(3)
    expect((await segmenter.segment(planned, 2)).ok).toBe(true)
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
    // The player asks for 8, then seeks to 0 before 8 arrives (its request for 8 not aborted).
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
})
