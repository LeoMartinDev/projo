import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import {
  decodesCleanly,
  ffprobeJson,
  generateVideo,
  hasFfmpeg,
} from '../../../test/support/media.ts'
import { planSegments } from '../../core/playback/hls-playlist.ts'
import type { HlsJob, HlsSegmenter } from '../../core/playback/ports.ts'
import { outputTimestampOffsetS } from './ffmpeg-args.ts'
import { createFfprobe, parseKeyframeCsv } from './ffprobe.ts'
import { createBoxSplitter, fragmentStartTicks, readTracks } from './fmp4.ts'
import { createHlsSegmenter } from './hls-segmenter.ts'
import { matroskaKeyframesOf } from './matroska-cues.ts'

const media = createTempDir('projo-media-')
const files: Record<string, string> = {}
const ffprobe = createFfprobe()

beforeAll(async () => {
  if (!hasFfmpeg()) return
  files['mkvAac'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'aac',
    durationS: 30,
  })
  files['mkvAc3'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'ac3',
    durationS: 20,
  })
  files['mkvFlac'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'h264',
    audio: 'flac',
    durationS: 14,
  })
  files['mkvHevc'] = await generateVideo(media.path, {
    container: 'mkv',
    video: 'hevc',
    audio: 'aac',
    durationS: 14,
  })
})
afterAll(() => media.cleanup())

let cache: ReturnType<typeof createTempDir> | undefined
let segmenter: HlsSegmenter | undefined
afterEach(async () => {
  await segmenter?.stopAll()
  cache?.cleanup()
  segmenter = undefined
})
const newSegmenter = (options: { bufferAhead?: number } = {}) => {
  const dir = createTempDir('projo-transcode-')
  const created = createHlsSegmenter({ transcodeDir: dir.path, logger: silentLogger, ...options })
  cache = dir
  segmenter = created
  return { segmenter: created, dir: dir.path }
}

const jobFor = async (
  sessionId: string,
  path: string,
  delivery: 'copy' | 'aac',
): Promise<HlsJob> => {
  const probe = await ffprobe.probe(path)
  if (!probe.ok) throw new Error(probe.error.message)
  const video = probe.value.video[0]
  const audio = probe.value.audio[0]
  if (video === undefined || audio === undefined) throw new Error('streams missing')
  const index = await ffprobe.extract({ path, videoStreamIndex: video.index })
  if (!index.ok) throw new Error(index.error.message)
  return {
    mode: 'hls_remux',
    sessionId,
    sourcePath: path,
    audioDownmix: 'stereo',
    hwAccel: 'off',
    segments: planSegments(index.value),
    keyframes: index.value.keyframes,
    video: { index: video.index, codec: video.codec },
    audio: { index: audio.index, delivery },
  }
}

/** init + segment glued together: what a player's MSE buffer receives. */
const playable = (init: string, segment: string, out: string): string => {
  writeFileSync(out, Buffer.concat([readFileSync(init), readFileSync(segment)]))
  return out
}

/** Start time (s, offset removed) of every video fragment of a segment file. */
const fragmentStarts = (init: string, segment: string): number[] => {
  const [moov] = createBoxSplitter()
    .push(new Uint8Array(readFileSync(init)))
    .filter((box) => box.type === 'moov')
  const video = readTracks(moov?.bytes ?? new Uint8Array()).find((t) => t.handler === 'vide')
  if (video === undefined) throw new Error('no video track')
  return createBoxSplitter()
    .push(new Uint8Array(readFileSync(segment)))
    .filter((box) => box.type === 'moof')
    .map((box) => (fragmentStartTicks(box.bytes, video.trackId) ?? NaN) / video.timescale)
    .map((time) => Math.round((time - outputTimestampOffsetS) * 1000) / 1000)
}

const unwrap = <T>(
  result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

describe.skipIf(!hasFfmpeg())('ffprobe (real binary)', () => {
  test('probes streams of a MKV', async () => {
    const probe = unwrap(await ffprobe.probe(files['mkvAc3'] ?? ''))
    expect(probe.formatName).toBe('matroska,webm')
    expect(probe.durationMs).toBe(20_000)
    expect(probe.video).toMatchObject([{ index: 0, codec: 'h264', width: 160, height: 90 }])
    expect(probe.audio).toMatchObject([{ index: 1, codec: 'ac3' }])
  })

  test('indexes keyframes (2 s GOP, B-frames)', async () => {
    const index = unwrap(
      await ffprobe.extract({ path: files['mkvAac'] ?? '', videoStreamIndex: 0 }),
    )
    expect(index.keyframes).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28])
    expect(index.durationS).toBeCloseTo(30, 1)
    expect(planSegments(index).map((s) => [s.startS, Math.round(s.endS)])).toEqual([
      [0, 6],
      [6, 12],
      [12, 18],
      [18, 24],
      [24, 30],
    ])
  })

  test('a MKV is indexed from its cues: the keyframes of the full packet scan', async () => {
    for (const path of [files['mkvAac'] ?? '', files['mkvHevc'] ?? '']) {
      const scan = Bun.spawnSync({
        cmd: [
          'ffprobe',
          '-v',
          'error',
          '-select_streams',
          '0',
          '-show_entries',
          'packet=pts_time,flags',
          '-of',
          'csv=p=0',
          path,
        ],
      })
      const fromCues = (await matroskaKeyframesOf(path))?.map((t) => Math.round(t * 1e6) / 1e6)
      expect(fromCues).toEqual(parseKeyframeCsv(scan.stdout.toString(), 0))
    }
  })

  test('a missing file is a typed error', async () => {
    expect(await ffprobe.probe('/nope/missing.mkv')).toMatchObject({
      ok: false,
      error: { code: 'media/ffprobe_failed' },
    })
  })
})

describe.skipIf(!hasFfmpeg())('HLS remux segmenter (real ffmpeg)', () => {
  test('init + first segment: playable fMP4, H.264 copied, AAC, segment aligned on its keyframes', async () => {
    const job = await jobFor('s-aac', files['mkvAac'] ?? '', 'copy')
    const { segmenter, dir } = newSegmenter()
    const init = unwrap(await segmenter.segment(job, 'init'))
    const first = unwrap(await segmenter.segment(job, 0))
    expect(init).toBe(join(dir, 's-aac', 'init.mp4'))
    expect(first).toBe(join(dir, 's-aac', 'seg-00000.m4s'))

    const glued = playable(init, first, join(dir, 'first.mp4'))
    const probe = await ffprobeJson(glued)
    expect(probe.streams.map((s) => [s.codec_type, s.codec_name])).toEqual([
      ['video', 'h264'],
      ['audio', 'aac'],
    ])
    // Timestamps carry the constant output offset (see ffmpeg-args.ts).
    expect(Number(probe.format.duration) - outputTimestampOffsetS).toBeCloseTo(6, 0)
    expect(await decodesCleanly(glued)).toBe(true)
    expect(fragmentStarts(init, first)).toEqual([0, 2, 4])
  })

  test('segments of a later run carry the same timeline (seek, then come back)', async () => {
    const job = await jobFor('s-seek', files['mkvAac'] ?? '', 'aac')
    const { segmenter, dir } = newSegmenter()
    // Seek first: ffmpeg starts on the keyframe of segment 3.
    const third = unwrap(await segmenter.segment(job, 3))
    const init = unwrap(await segmenter.segment(job, 'init'))
    expect(fragmentStarts(init, third)).toEqual([18, 20, 22])
    expect(await decodesCleanly(playable(init, third, join(dir, 'third.mp4')))).toBe(true)
    // Back to the start: outside the window, ffmpeg restarts at 0.
    const zero = unwrap(await segmenter.segment(job, 0))
    expect(fragmentStarts(init, zero)).toEqual([0, 2, 4])
    // Sequential requests are served by the running ffmpeg.
    const next = unwrap(await segmenter.segment(job, 1))
    expect(fragmentStarts(init, next)).toEqual([6, 8, 10])
    // The last segment ends the file.
    const last = unwrap(await segmenter.segment(job, 4))
    expect(fragmentStarts(init, last)).toEqual([24, 26, 28])
    expect(await decodesCleanly(playable(init, last, join(dir, 'last.mp4')))).toBe(true)
  })

  test('AC-3 copied as is (Safari), FLAC transcoded to AAC', async () => {
    const { segmenter, dir } = newSegmenter()
    const ac3 = await jobFor('s-ac3', files['mkvAc3'] ?? '', 'copy')
    const ac3Init = unwrap(await segmenter.segment(ac3, 'init'))
    const ac3Segment = unwrap(await segmenter.segment(ac3, 1))
    const ac3Probe = await ffprobeJson(playable(ac3Init, ac3Segment, join(dir, 'ac3.mp4')))
    expect(ac3Probe.streams.map((s) => s.codec_name)).toEqual(['h264', 'ac3'])

    const flac = await jobFor('s-flac', files['mkvFlac'] ?? '', 'aac')
    const flacInit = unwrap(await segmenter.segment(flac, 'init'))
    const flacSegment = unwrap(await segmenter.segment(flac, 0))
    const flacProbe = await ffprobeJson(playable(flacInit, flacSegment, join(dir, 'flac.mp4')))
    expect(flacProbe.streams.map((s) => s.codec_name)).toEqual(['h264', 'aac'])
  })

  test('HEVC is copied with the hvc1 tag (Safari)', async () => {
    const { segmenter, dir } = newSegmenter()
    const job = await jobFor('s-hevc', files['mkvHevc'] ?? '', 'copy')
    const init = unwrap(await segmenter.segment(job, 'init'))
    const segment = unwrap(await segmenter.segment(job, 0))
    expect(new TextDecoder().decode(readFileSync(init))).toContain('hvc1')
    expect(await decodesCleanly(playable(init, segment, join(dir, 'hevc.mp4')))).toBe(true)
  })

  test('production pauses ahead of the player', async () => {
    const job = await jobFor('s-throttle', files['mkvAac'] ?? '', 'copy')
    const { segmenter, dir } = newSegmenter({ bufferAhead: 0 })
    unwrap(await segmenter.segment(job, 0))
    await Bun.sleep(300)
    // Only the requested segment (and the one being accumulated) can exist.
    expect(existsSync(join(dir, 's-throttle', 'seg-00003.m4s'))).toBe(false)
    // The next request lets it go on.
    unwrap(await segmenter.segment(job, 1))
    segmenter.stop('s-throttle')
  })

  test('unknown segment index: not found', async () => {
    const job = await jobFor('s-404', files['mkvAac'] ?? '', 'copy')
    const { segmenter } = newSegmenter()
    expect(await segmenter.segment(job, 99)).toMatchObject({
      ok: false,
      error: { code: 'playback/segment_not_found' },
    })
  })
})

describe('segmenter: a stopped session stays stopped (§10.6)', () => {
  test('a request arriving after stop neither recreates state nor starts ffmpeg', async () => {
    const { segmenter, dir } = newSegmenter()
    const job: HlsJob = {
      mode: 'hls_remux',
      audioDownmix: 'stereo',
      hwAccel: 'off',
      sessionId: 's-stopped',
      sourcePath: join(dir, 'missing.mkv'),
      segments: [{ index: 0, startS: 0, endS: 4 }],
      keyframes: [0, 2],
      video: { index: 0, codec: 'h264' },
    }
    segmenter.stop('s-stopped')
    expect(await segmenter.segment(job, 0)).toMatchObject({
      ok: false,
      error: { code: 'playback/stream_failed', message: 'playback session stopped' },
    })
    expect(segmenter.sessionIds()).toEqual([])
    expect(existsSync(join(dir, 's-stopped'))).toBe(false)
  })
})
