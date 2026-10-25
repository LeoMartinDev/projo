import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { closeSync, mkdirSync, openSync, ftruncateSync } from 'node:fs'
import { join } from 'node:path'

import type { LibraryDto } from '@projo/shared/api/libraries'

import { createTempDir } from '../support/database.ts'
import { createScannerWorld } from '../support/scanner-world.ts'

setDefaultTimeout(120_000)

const FILES = 5_000
const tmp = createTempDir('projo-perf-')
const world = createScannerWorld()
afterAll(async () => {
  await world.stop()
  tmp.cleanup()
})

/** Sparse 1.5 MB files: real sizes for the scanner, almost nothing on disk. No probe runs here. */
const generate = () => {
  for (let i = 0; i < FILES; i += 1) {
    const series = Math.floor(i / 50)
    const dir = join(tmp.path, `Show ${series}`, `Season ${(i % 5) + 1}`)
    mkdirSync(dir, { recursive: true })
    const fd = openSync(
      join(dir, `Show.${series}.S0${(i % 5) + 1}E${String(i % 100).padStart(2, '0')}.${i}.mkv`),
      'w',
    )
    ftruncateSync(fd, 1_500_000)
    closeSync(fd)
  }
}

describe('§21 scan performance (indicative)', () => {
  test(`incremental scan of ${FILES} unchanged files stays under 10 s`, async () => {
    generate()
    const response = await world.request('/libraries', {
      method: 'POST',
      json: { name: 'Perf', roots: [tmp.path] },
    })
    const library = (await response.json()) as LibraryDto
    const firstStart = performance.now()
    await world.runJobs(['scan_library'])
    const firstMs = performance.now() - firstStart
    expect(world.query('SELECT count(*) AS n FROM sources')).toEqual([{ n: FILES }])

    await world.request(`/libraries/${library.id}/scan`, {
      method: 'POST',
      json: { mode: 'quick' },
    })
    const start = performance.now()
    await world.runJobs(['scan_library'])
    const incrementalMs = performance.now() - start
    const lastRun = world.query<{ stats: string }>(
      'SELECT stats FROM scan_runs ORDER BY id DESC LIMIT 1',
    )[0]
    expect(JSON.parse(lastRun?.stats ?? '{}')).toMatchObject({
      seen: FILES,
      discovered: 0,
      pending: 0,
      missing: 0,
    })
    console.info(
      `scan perf: first ${Math.round(firstMs)} ms, incremental ${Math.round(incrementalMs)} ms for ${FILES} files`,
    )
    expect(incrementalMs).toBeLessThan(10_000)
  })
})
