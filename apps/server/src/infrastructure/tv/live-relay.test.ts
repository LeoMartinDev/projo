import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'

import { createTempDir } from '../../../test/support/database.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import { generateVideo, hasFfmpeg } from '../../../test/support/media.ts'
import type { LiveCompatSpec } from '../../core/tv/live.ts'
import { createLiveRelay } from './live-relay.ts'

let temp: ReturnType<typeof createTempDir>
let root = ''
let segments: string[] = []

const until = async (condition: () => boolean, timeoutMs = 20_000): Promise<void> => {
  const end = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out')
    await Bun.sleep(50)
  }
}

/** A copy stream's run 1 in `<liveDir>/a/`: what the compat runs read. */
const writeCopyRun = async (liveDir: string): Promise<string[]> => {
  const dir = `${liveDir}/a`
  mkdirSync(dir, { recursive: true })
  const video = await generateVideo(root, {
    container: 'mp4',
    video: 'h264',
    audio: 'aac',
    durationS: 8,
  })
  const proc = Bun.spawn(
    [
      'ffmpeg',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      video,
      '-c',
      'copy',
      '-f',
      'hls',
      '-hls_segment_type',
      'fmp4',
      '-hls_time',
      '2',
      '-hls_list_size',
      '0',
      '-hls_fmp4_init_filename',
      'init-1.mp4',
      '-hls_segment_filename',
      `${dir}/seg-1-%05d.m4s`,
      `${dir}/run-1.m3u8`,
    ],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  if ((await proc.exited) !== 0) throw new Error('no copy run')
  return readdirSync(dir)
    .filter((name) => name.endsWith('.m4s'))
    .sort()
}

const spec = (run: number): LiveCompatSpec => ({
  channelId: 'a',
  run,
  copyRun: 1,
  video: { codec: 'h264', pixelFormat: 'yuv420p', fieldOrder: 'progressive' },
})

const vaapiWorld = () => {
  const { logger, lines } = createCapturingLogger()
  const notified: unknown[] = []
  const resolved: unknown[] = []
  const notifier = {
    notify: (input: unknown) => void notified.push(input),
    resolve: (input: unknown) => void resolved.push(input),
  }
  return { logger, lines, notifier, notified, resolved }
}

describe.skipIf(!hasFfmpeg())('live relay: compat runs with real ffmpeg (§29.4)', () => {
  beforeAll(async () => {
    temp = createTempDir('projo-live-relay-')
    root = temp.path.replaceAll('\\', '/')
    segments = await writeCopyRun(`${root}/live`)
  })
  afterAll(() => {
    temp.cleanup()
  })

  test('a VAAPI run failing before its init steps down: CPU decoding, then software', async () => {
    const world = vaapiWorld()
    const fakeNode = `${root}/fake-render-node`
    writeFileSync(fakeNode, '')
    const relay = createLiveRelay({
      liveDir: `${root}/live`,
      logger: world.logger,
      hwAccel: () => 'vaapi',
      renderNode: fakeNode,
      notifier: world.notifier,
    })
    // GPU decoding: the device cannot be opened, nothing written.
    expect((await relay.startCompat(spec(1)).exited).exitCode).not.toBe(0)
    expect(
      world.lines.filter((line) => line.fields['code'] === 'playback/hw_decode_unsupported'),
    ).toEqual([expect.objectContaining({ level: 'info' })])
    expect(world.notified).toEqual([])
    // CPU decoding, uploaded to the same device: fails too, the admin is notified.
    expect((await relay.startCompat(spec(2)).exited).exitCode).not.toBe(0)
    expect(world.notified).toEqual([
      expect.objectContaining({
        kind: 'playback/hw_accel_failed',
        key: 'vaapi',
        context: expect.objectContaining({ reason: 'ffmpeg_failed', codec: 'h264' }),
      }),
    ])
    // Software from then on, for this stream: it transcodes what it is fed.
    const software = relay.startCompat(spec(3))
    for (const name of segments) software.feed(name)
    await until(() => relay.segmentsOf({ channelId: 'a', rendition: 'compat', run: 3 }).length > 0)
    expect(existsSync(`${root}/live/a-compat/init-3.mp4`)).toBe(true)
    await software.stop()
    expect(world.notified).toHaveLength(1)
    expect(world.resolved).toEqual([])

    // A new stream of the channel chooses afresh.
    relay.removeStream({ channelId: 'a', rendition: 'compat' })
    expect(existsSync(`${root}/live/a-compat`)).toBe(false)
    const again = relay.startCompat(spec(1))
    await again.exited
    expect(
      world.lines.filter((line) => line.fields['code'] === 'playback/hw_decode_unsupported'),
    ).toHaveLength(2)
  }, 60_000)

  test('the backlog counts segments fed that ffmpeg has not taken; a missing one is a warning', async () => {
    const { logger, lines } = createCapturingLogger()
    const relay = createLiveRelay({ liveDir: `${root}/live`, logger })
    const run = relay.startCompat(spec(4))
    for (const name of segments) run.feed(name)
    expect(run.backlog()).toBe(segments.length)
    await until(() => run.backlog() === 0)
    run.feed('seg-1-00099.m4s')
    await until(() => run.backlog() === 0)
    expect(lines.filter((line) => line.message === 'live compat input not written')).toEqual([
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({ channelId: 'a', name: 'seg-1-00099.m4s' }),
      }),
    ])
    await run.stop()
    relay.removeStream({ channelId: 'a', rendition: 'compat' })
  }, 60_000)
})
