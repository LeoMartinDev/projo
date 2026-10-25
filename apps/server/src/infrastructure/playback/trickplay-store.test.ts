import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { hasFfmpeg } from '../../../test/support/media.ts'
import { createTrickplayStore } from './trickplay-store.ts'

/**
 * §10.5 against the real ffmpeg: thumbnail `i` is the picture at `i × interval`, even when the
 * keyframes are far from those instants.
 */

const dir = createTempDir('projo-trickplay-')
const fingerprint = { sizeBytes: 1, mtimeMs: 1 }
let video = ''

const run = async (cmd: string[]) => {
  const proc = Bun.spawn({ cmd, stdout: 'pipe', stderr: 'pipe' })
  const [code, out, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).bytes(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(`${cmd[0]} failed: ${stderr}`)
  return out
}

beforeAll(async () => {
  if (!hasFfmpeg()) return
  video = join(dir.path, 'ramp.mp4')
  // The luminance is 16 + 9 × the second: reading it back dates the picture. One keyframe every 15 s
  // (`-g 360` at 24 fps), none at 10 s or 20 s.
  await run([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    "color=c=black:s=160x90:r=24:d=25,format=yuv420p,geq=lum='16+9*T':cb=128:cr=128",
    '-c:v',
    'libx264',
    '-g',
    '360',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    video,
  ])
})

afterAll(() => dir.cleanup())

describe.skipIf(!hasFfmpeg())('trickplay store', () => {
  test('each thumbnail is the picture at its instant, not at the keyframe before it', async () => {
    const store = createTrickplayStore({ trickplayDir: join(dir.path, 'trickplay') })
    const generated = await store.generate({
      sourceId: 'src',
      path: video,
      videoStreamIndex: 0,
      height: 180,
      fingerprint,
    })
    expect(generated.ok).toBe(true)
    const sheet = store.sheetPath({ sourceId: 'src', sheet: 0 })
    expect(sheet).toBeDefined()
    if (sheet === undefined) return

    // Mean luminance of the middle of thumbnails 0, 1 and 2 (320×180 each, 10 per row).
    const luma = async (index: number) => {
      const bytes = await run([
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sheet,
        '-vf',
        `crop=40:40:${index * 320 + 140}:70,scale=1:1:flags=area,format=gray`,
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-',
      ])
      return bytes[0] ?? -1
    }
    // 90 luminance levels (105 once expanded to full range) between two instants 10 s apart; with
    // the keyframe before each instant (0 s, 0 s, 15 s) the first step would be nil.
    const [first = 0, second = 0, third = 0] = [await luma(0), await luma(1), await luma(2)]
    expect(second - first).toBeGreaterThan(85)
    expect(second - first).toBeLessThan(125)
    expect(third - second).toBeGreaterThan(85)
    expect(third - second).toBeLessThan(125)
  })

  test('sheets of the previous generation are not served', async () => {
    const trickplayDir = join(dir.path, 'legacy')
    const store = createTrickplayStore({ trickplayDir })
    await store.generate({
      sourceId: 'old',
      path: video,
      videoStreamIndex: 0,
      height: 180,
      fingerprint,
    })
    expect(store.read('old')).toBeDefined()
    await Bun.write(join(trickplayDir, 'old', 'source.json'), JSON.stringify(fingerprint))
    expect(store.read('old')).toBeUndefined()
  })
})
