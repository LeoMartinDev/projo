/**
 * Records the libmpv sequences the web `mpv` engine's tests replay (PRODUCT.md
 * §28.8): runs the engine contract's steps in the desktop app against its real
 * libmpv and writes them to the engine's fixtures.
 *
 * Windows, with a debug build of the desktop app (`cargo build` in
 * apps/desktop/src-tauri, libmpv-2.dll next to it) and ffmpeg on the PATH:
 *
 *   bun e2e/scripts/record-mpv-sequences.ts [path/to/projo-desktop.exe]
 *
 * The app opens without focus, connects to a stand-in server served here
 * (its `/health`, a blank page, the media with HTTP Range and a gate that
 * throttles or stops it) and is driven over WebView2's DevTools protocol.
 * libmpv runs with `ao=null`: no sound. Everything it created is removed.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { chromium } from '@playwright/test'

const root = resolve(import.meta.dir, '../..')
const engineDir = join(root, 'apps/web/src/features/player/engines/mpv')
const output = join(engineDir, 'fixtures/contract-recording.json')
const exe = process.argv[2] ?? process.env['PROJO_DESKTOP_EXE'] ?? 'C:\\t\\debug\\projo-desktop.exe'
const identifier = 'dev.leomartin.projo.desktop'
const mediaPort = 4891
const devtoolsPort = 9334
const durationS = 60

if (process.platform !== 'win32') throw new Error('the desktop app runs on Windows only')
if (!existsSync(exe)) throw new Error(`${exe} is missing: build apps/desktop/src-tauri first`)

const appData = [
  join(process.env['APPDATA'] ?? '', identifier),
  join(process.env['LOCALAPPDATA'] ?? '', identifier),
]
const leftover = appData.filter((dir) => existsSync(dir))
if (leftover.length > 0)
  throw new Error(`${leftover.join(', ')} exists: the recording would change a real configuration`)

const work = mkdtempSync(join(tmpdir(), 'projo-mpv-recording-'))
const video = join(work, 'contract.mkv')
const encoded = spawnSync(
  'ffmpeg',
  [
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=320x240:rate=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000',
    '-t',
    String(durationS),
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '30',
    '-g',
    '20',
    '-c:a',
    'ac3',
    '-b:a',
    '96k',
    '-shortest',
    video,
  ],
  { stdio: 'inherit' },
)
if (encoded.status !== 0) throw new Error('ffmpeg failed')
const size = statSync(video).size
// A trickle a little faster than the stream keeps libmpv's cache a few seconds ahead.
const trickleBytesPerS = Math.ceil((size / durationS) * 1.3)

let gate: 'open' | 'trickle' | 'closed' = 'open'
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

const body = (start: number, end: number) => {
  const file = Bun.file(video)
  let offset = start
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      while (gate === 'closed') await sleep(50)
      if (offset > end) {
        controller.close()
        return
      }
      const chunk = gate === 'open' ? 256 * 1024 : Math.ceil(trickleBytesPerS / 10)
      const next = Math.min(end + 1, offset + chunk)
      controller.enqueue(new Uint8Array(await file.slice(offset, next).arrayBuffer()))
      offset = next
      if (gate === 'trickle') await sleep(100)
    },
  })
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: mediaPort,
  fetch: (request) => {
    const url = new URL(request.url)
    if (url.pathname === '/health')
      return Response.json({ status: 'ok', version: '0.0.0-mpv-recording' })
    if (url.pathname === '/')
      return new Response('<!doctype html><title>mpv recording</title>', {
        headers: { 'content-type': 'text/html' },
      })
    if (url.pathname === '/gate') {
      const mode = url.searchParams.get('mode')
      if (mode === 'open' || mode === 'trickle' || mode === 'closed') gate = mode
      return new Response('ok', { headers: { 'access-control-allow-origin': '*' } })
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') ?? '') ?? undefined
    const start = range === undefined ? 0 : Number(range[1])
    const end = range === undefined || range[2] === '' ? size - 1 : Number(range[2])
    const headers = {
      'content-type': 'video/x-matroska',
      'accept-ranges': 'bytes',
      'content-length': String(end - start + 1),
      ...(range === undefined ? {} : { 'content-range': `bytes ${start}-${end}/${size}` }),
    }
    if (request.method === 'HEAD') return new Response(undefined, { headers })
    return new Response(body(start, end), { status: range === undefined ? 200 : 206, headers })
  },
})

const built = await Bun.build({
  entrypoints: [join(engineDir, 'recording/record-contract.ts')],
  target: 'browser',
  format: 'iife',
})
if (!built.success) throw new Error(built.logs.map(String).join('\n'))
const recorder = await built.outputs[0]?.text()
if (recorder === undefined) throw new Error('no recorder bundle')

const app = Bun.spawn({
  cmd: [exe],
  env: {
    ...process.env,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${devtoolsPort}`,
    PROJO_DESKTOP_TEST_WINDOW: '3700,80',
    RUST_LOG: 'warn',
  },
  stdout: 'inherit',
  stderr: 'inherit',
})

try {
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  for (let attempt = 0; browser === undefined; attempt += 1) {
    await sleep(500)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${devtoolsPort}`).catch((error) => {
      if (attempt > 40) throw error
      return undefined
    })
  }
  const context = browser.contexts()[0]
  const page = context?.pages()[0]
  if (page === undefined) throw new Error('no page in the app window')
  await page.locator('#url').fill(`http://127.0.0.1:${mediaPort}`)
  await page.locator('#submit').click()
  await page.waitForURL(`http://127.0.0.1:${mediaPort}/`)
  await page.evaluate(recorder)
  const recording = await page.evaluate(async () => {
    const record = (window as { projoRecordContract?: () => Promise<unknown> }).projoRecordContract
    if (record === undefined) throw new Error('the recorder did not load')
    return record()
  })
  await Bun.write(output, `${JSON.stringify(recording, undefined, 2)}\n`)
  console.log(`recorded ${output}`)
  await browser.close()
} finally {
  app.kill()
  await app.exited
  server.stop(true)
  rmSync(work, { recursive: true, force: true })
  // WebView2 lets go of its folder a moment after the app exits.
  await sleep(2000)
  for (const dir of appData) rmSync(dir, { recursive: true, force: true })
}
