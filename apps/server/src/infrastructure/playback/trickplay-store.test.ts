import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { hasFfmpeg } from '../../../test/support/media.ts'
import { createTrickplayStore } from './trickplay-store.ts'

/**
 * §10.5 against the real ffmpeg, keyframes only: thumbnail `i` is the last keyframe at or before
 * `i × interval`, and there is one thumbnail per started interval of the file, even when its last
 * keyframe is long before the end.
 */

const dir = createTempDir('projo-trickplay-')
const fingerprint = { sizeBytes: 1, mtimeMs: 1 }
const videos = { long: '', short: '' }

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

/**
 * The luminance is 40 + 6 × the second: reading it back dates the picture. One keyframe every
 * 15 s (`-g 360` at 24 fps): for 25 s, keyframes at 0 and 15 s only, none at 10 s or 20 s.
 */
const ramp = async (name: string, durationS: number) => {
  const path = join(dir.path, name)
  await run([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=160x90:r=24:d=${durationS},format=yuv420p,geq=lum='40+6*T':cb=128:cr=128`,
    '-c:v',
    'libx264',
    '-g',
    '360',
    '-keyint_min',
    '360',
    '-sc_threshold',
    '0',
    '-pix_fmt',
    'yuv420p',
    path,
  ])
  return path
}

beforeAll(async () => {
  if (!hasFfmpeg()) return
  videos.long = await ramp('ramp-25s.mp4', 25)
  videos.short = await ramp('ramp-5s.mp4', 5)
})

afterAll(() => dir.cleanup())

/** Mean luminance (full range) of the middle of thumbnail `index` (320×180, 10 per row). */
const luma = async (sheet: string, index: number) => {
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

/** Limited-range luminance `y` once expanded to full range, as in the JPEG sheets. */
const fullRange = (y: number) => ((y - 16) * 255) / 219

describe.skipIf(!hasFfmpeg())('trickplay store', () => {
  test('each thumbnail is the last keyframe at or before its instant, up to the end', async () => {
    const store = createTrickplayStore({ trickplayDir: join(dir.path, 'trickplay') })
    const generated = await store.generate({
      sourceId: 'src',
      path: videos.long,
      videoStreamIndex: 0,
      height: 180,
      durationMs: 25_000,
      fingerprint,
    })
    expect(generated).toMatchObject({ ok: true, value: { sheets: [0] } })
    const sheet = store.sheetPath({ sourceId: 'src', sheet: 0 })
    expect(sheet).toBeDefined()
    if (sheet === undefined) return

    const cells = [
      await luma(sheet, 0),
      await luma(sheet, 1),
      await luma(sheet, 2),
      await luma(sheet, 3),
    ]
    // 0 s and 10 s: the keyframe at 0 s; 20 s: the one at 15 s, although it ends at 15.04 s
    // (3 thumbnails for 25 s); no fourth one (the tile's black padding).
    const [at0 = 0, at10 = 0, at20 = 0, after = 255] = cells
    expect(Math.abs(at0 - fullRange(40))).toBeLessThan(8)
    expect(Math.abs(at10 - at0)).toBeLessThan(4)
    expect(Math.abs(at20 - fullRange(40 + 6 * 15))).toBeLessThan(8)
    expect(after).toBeLessThan(4)
  })

  test('a file shorter than the interval gets one thumbnail', async () => {
    const store = createTrickplayStore({ trickplayDir: join(dir.path, 'short') })
    const generated = await store.generate({
      sourceId: 'short',
      path: videos.short,
      videoStreamIndex: 0,
      height: 180,
      durationMs: 5_000,
      fingerprint,
    })
    expect(generated).toMatchObject({ ok: true, value: { sheets: [0] } })
    const sheet = store.sheetPath({ sourceId: 'short', sheet: 0 })
    if (sheet === undefined) throw new Error('no sheet')
    expect(Math.abs((await luma(sheet, 0)) - fullRange(40))).toBeLessThan(8)
    expect(await luma(sheet, 1)).toBeLessThan(4)
  })

  test('sheets of the previous generation are not served', async () => {
    const trickplayDir = join(dir.path, 'legacy')
    const store = createTrickplayStore({ trickplayDir })
    await store.generate({
      sourceId: 'old',
      path: videos.long,
      videoStreamIndex: 0,
      height: 180,
      durationMs: 25_000,
      fingerprint,
    })
    expect(store.read('old')).toBeDefined()
    await Bun.write(join(trickplayDir, 'old', 'source.json'), JSON.stringify(fingerprint))
    expect(store.read('old')).toBeUndefined()
  })
})
