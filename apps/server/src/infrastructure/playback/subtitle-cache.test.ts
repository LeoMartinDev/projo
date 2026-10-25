import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { videoWithEmbeddedSubtitles } from '../../../test/support/media-fixtures.ts'
import { createTempDir } from '../../../test/support/database.ts'
import { hasFfmpeg } from '../../../test/support/media.ts'
import { createSubtitleCache } from './subtitle-cache.ts'

const latin1 = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)))

let dir: ReturnType<typeof createTempDir>
let ffmpegRuns: () => number
let cache: ReturnType<typeof createSubtitleCache>

beforeEach(() => {
  dir = createTempDir('projo-subtitle-cache-')
  // ffmpeg behind a wrapper that counts its runs.
  const log = join(dir.path, 'runs.log')
  writeFileSync(log, '')
  const wrapper = join(dir.path, 'ffmpeg.sh')
  writeFileSync(wrapper, `#!/bin/sh\necho run >> '${log}'\nexec ffmpeg "$@"\n`)
  chmodSync(wrapper, 0o755)
  ffmpegRuns = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).length
  cache = createSubtitleCache({ subtitlesDir: join(dir.path, 'subtitles'), ffmpeg: wrapper })
})
afterEach(() => dir.cleanup())

describe.skipIf(!hasFfmpeg())('subtitle cache (§10.4)', () => {
  test('a Latin-1 SRT becomes UTF-8 WebVTT, cached until the file changes', async () => {
    const srt = join(dir.path, 'Film.fr.srt')
    writeFileSync(srt, latin1('1\r\n00:00:01,000 --> 00:00:02,500\r\nÉté à la plage, déjà vu\r\n'))
    const input = { kind: 'external', path: srt, format: 'srt' } as const

    const first = await cache.ensure({ sourceId: 'source-1', trackId: 'track-1', input })
    expect(first).toEqual({ ok: true, value: join(dir.path, 'subtitles/source-1/track-1.vtt') })
    const vtt = readFileSync(join(dir.path, 'subtitles/source-1/track-1.vtt'), 'utf8')
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('00:01.000 --> 00:02.500')
    expect(vtt).toContain('Été à la plage, déjà vu')
    expect(ffmpegRuns()).toBe(1)

    // Served from the cache, then rebuilt once the file changed.
    await cache.ensure({ sourceId: 'source-1', trackId: 'track-1', input })
    expect(ffmpegRuns()).toBe(1)
    writeFileSync(srt, latin1('1\r\n00:00:01,000 --> 00:00:02,500\r\nÇa change\r\n'))
    utimesSync(srt, new Date(), new Date(Date.now() + 5_000))
    await cache.ensure({ sourceId: 'source-1', trackId: 'track-1', input })
    expect(ffmpegRuns()).toBe(2)
    expect(readFileSync(join(dir.path, 'subtitles/source-1/track-1.vtt'), 'utf8')).toContain(
      'Ça change',
    )
    expect(cache.listSourceIds()).toEqual(['source-1'])
    expect(cache.listTrackIds('source-1')).toEqual(['track-1'])
  })

  test('concurrent requests share one conversion', async () => {
    const srt = join(dir.path, 'Film.srt')
    writeFileSync(srt, '1\n00:00:00,500 --> 00:00:01,000\nHi\n')
    const input = { kind: 'external', path: srt, format: 'srt' } as const
    const results = await Promise.all(
      [1, 2, 3].map(() => cache.ensure({ sourceId: 's', trackId: 't', input })),
    )
    expect(results.every((result) => result.ok)).toBe(true)
    expect(ffmpegRuns()).toBe(1)
  })

  test('embedded tracks: extracted with -map 0:<index>, several in one pass', async () => {
    const video = videoWithEmbeddedSubtitles()
    const single = await cache.ensure({
      sourceId: 'video',
      trackId: 'embedded-2',
      input: { kind: 'embedded', path: video, streamIndex: 2 },
    })
    expect(single.ok).toBe(true)
    expect(readFileSync(join(dir.path, 'subtitles/video/embedded-2.vtt'), 'utf8')).toContain(
      'Hello',
    )

    cache.remove({ sourceId: 'video' })
    expect(cache.listSourceIds()).toEqual([])
    const runs = ffmpegRuns()
    expect(
      await cache.ensureEmbedded({
        sourceId: 'video',
        path: video,
        tracks: [
          { trackId: 'a', streamIndex: 2 },
          { trackId: 'b', streamIndex: 2 },
        ],
      }),
    ).toEqual({ ok: true, value: undefined })
    expect(ffmpegRuns()).toBe(runs + 1)
    expect(cache.listTrackIds('video').toSorted()).toEqual(['a', 'b'])
    // Already extracted: nothing to run.
    await cache.ensureEmbedded({
      sourceId: 'video',
      path: video,
      tracks: [{ trackId: 'a', streamIndex: 2 }],
    })
    expect(ffmpegRuns()).toBe(runs + 1)
  })

  test('a pre-extraction pass that fails or is cancelled: the requested track alone', async () => {
    const video = videoWithEmbeddedSubtitles()
    const embedded = { kind: 'embedded', path: video, streamIndex: 2 } as const
    // Stream 9 does not exist: the whole pass fails.
    const failing = cache.ensureEmbedded({
      sourceId: 'video',
      path: video,
      tracks: [
        { trackId: 'good', streamIndex: 2 },
        { trackId: 'bad', streamIndex: 9 },
      ],
    })
    const requested = cache.ensure({ sourceId: 'video', trackId: 'good', input: embedded })
    expect(await failing).toMatchObject({ ok: false, error: { code: 'media/ffmpeg_failed' } })
    expect(await requested).toMatchObject({ ok: true })
    expect(readFileSync(join(dir.path, 'subtitles/video/good.vtt'), 'utf8')).toContain('Hello')

    // The pre-extraction job is cancelled: a player asking meanwhile still gets its track.
    const controller = new AbortController()
    const cancelled = cache.ensureEmbedded({
      sourceId: 'video',
      path: video,
      tracks: [{ trackId: 'other', streamIndex: 2 }],
      signal: controller.signal,
    })
    const asked = cache.ensure({ sourceId: 'video', trackId: 'other', input: embedded })
    controller.abort()
    expect((await cancelled).ok).toBe(false)
    expect(await asked).toMatchObject({ ok: true })
  })

  test('listings skip names that are not ids; stale temporaries are removed', async () => {
    const root = join(dir.path, 'subtitles')
    mkdirSync(join(root, 'a b'), { recursive: true })
    mkdirSync(join(root, 'source'), { recursive: true })
    writeFileSync(join(root, 'source', 'x y.vtt'), '')
    writeFileSync(join(root, 'source', 'track.vtt'), '')
    const stale = join(root, 'source', 'track.tmp-1-1.vtt')
    const fresh = join(root, 'source', 'track.tmp-2-2.vtt')
    writeFileSync(stale, '')
    writeFileSync(fresh, '')
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000)
    utimesSync(stale, dayAgo, dayAgo)
    expect(cache.listSourceIds()).toEqual(['source'])
    expect(cache.listTrackIds('source')).toEqual(['track'])
    expect(cache.removeStaleTemporaries(new Date(Date.now() - 60 * 60_000))).toBe(1)
    expect([existsSync(stale), existsSync(fresh)]).toEqual([false, true])
  })

  test('a missing input file is source_unavailable, a broken one media/ffmpeg_failed', async () => {
    expect(
      await cache.ensure({
        sourceId: 's',
        trackId: 't',
        input: { kind: 'external', path: join(dir.path, 'nope.srt'), format: 'srt' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'playback/source_unavailable' } })
    const broken = join(dir.path, 'broken.srt')
    writeFileSync(broken, new Uint8Array([0, 1, 2, 3, 255]))
    expect(
      await cache.ensure({
        sourceId: 's',
        trackId: 't',
        input: { kind: 'embedded', path: broken, streamIndex: 4 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'media/ffmpeg_failed' } })
    expect(cache.listTrackIds('s')).toEqual([])
  })

  test('ids are never paths', async () => {
    const input = { kind: 'external', path: join(dir.path, 'x.srt'), format: 'srt' } as const
    expect(() => cache.remove({ sourceId: '../etc' })).toThrow()
    await expect(cache.ensure({ sourceId: 's', trackId: '../../x', input })).rejects.toThrow()
  })
})
