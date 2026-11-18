import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { hasFfmpeg } from '../../../test/support/media.ts'
import { liveProtocols } from './live-args.ts'
import { createLiveProber } from './live-prober.ts'

/** ffprobe on real upstreams served here (§29.4): the allowed protocols and the abort. */

let temp: ReturnType<typeof createTempDir>
let server: ReturnType<typeof Bun.serve>
let segment: string

/** A 2 s MPEG-TS of H.264 and AAC on disk: what a local file reference would expose. */
const writeSegment = (dir: string): string => {
  const path = join(dir, 'local.ts').replaceAll('\\', '/')
  Bun.spawnSync([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=25',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-f',
    'mpegts',
    path,
  ])
  return path
}

const fileUrlOf = (path: string): string => `file:${path.startsWith('/') ? '' : '/'}${path}`

describe.skipIf(!hasFfmpeg())('the live prober with real ffprobe (§29.4)', () => {
  beforeEach(() => {
    temp = createTempDir()
    segment = writeSegment(temp.path)
    server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname
        if (path === '/local.m3u8') {
          // A provider's HLS playlist pointing at a file of the server's disk.
          return new Response(
            [
              '#EXTM3U',
              '#EXT-X-VERSION:3',
              '#EXT-X-TARGETDURATION:2',
              '#EXT-X-MEDIA-SEQUENCE:0',
              '#EXTINF:2.0,',
              fileUrlOf(segment),
              '#EXT-X-ENDLIST',
              '',
            ].join('\n'),
            { headers: { 'content-type': 'application/vnd.apple.mpegurl' } },
          )
        }
        if (path === '/silent.ts') {
          // Answers, then never sends a byte: ffprobe waits until it is killed.
          return new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
            headers: { 'content-type': 'video/mp2t' },
          })
        }
        return new Response(Bun.file(segment), { headers: { 'content-type': 'video/mp2t' } })
      },
    })
  })
  afterEach(() => {
    void server.stop(true)
    temp.cleanup()
  })

  const at = (path: string) => `http://127.0.0.1:${server.port}${path}`

  test('reads an HTTP upstream', async () => {
    const probed = await createLiveProber().probe({
      upstream: { url: at('/live.ts') },
      signal: new AbortController().signal,
    })
    expect(probed).toMatchObject({
      ok: true,
      value: { video: { codec: 'h264' }, audio: [{ codec: 'aac' }] },
    })
  }, 30_000)

  test("an upstream's playlist cannot make ffprobe read a local file", async () => {
    const probed = await createLiveProber({ timeoutMs: 10_000 }).probe({
      upstream: { url: at('/local.m3u8') },
      signal: new AbortController().signal,
    })
    expect(probed).toMatchObject({ ok: false, error: { code: 'tv/stream_unavailable' } })
    // Refused by the relay's own list (ffmpeg's default for HTTP refuses it too).
    expect(JSON.stringify(probed)).toContain(`not on whitelist '${liveProtocols}'`)
  }, 30_000)

  test('an aborted probe kills ffprobe at once', async () => {
    const controller = new AbortController()
    const started = performance.now()
    const probing = createLiveProber().probe({
      upstream: { url: at('/silent.ts') },
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 300)
    expect(await probing).toMatchObject({
      ok: false,
      error: { code: 'tv/stream_unavailable', context: { reason: 'aborted' } },
    })
    expect(performance.now() - started).toBeLessThan(5_000)
  }, 10_000)
})
