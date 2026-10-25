import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'

import type { LibraryDto } from '@projo/shared/api/libraries'

import { createTempDir } from '../support/database.ts'
import {
  growFile,
  placeCorruptedVideo,
  placeGarbage,
  placeVideo,
} from '../support/media-fixtures.ts'
import { createScannerWorld, type ScannerWorld } from '../support/scanner-world.ts'

// Real ffprobe and ffmpeg on generated 3 s videos (§22).
setDefaultTimeout(60_000)

let world: ScannerWorld
let tmp: ReturnType<typeof createTempDir>

beforeEach(() => {
  world = createScannerWorld()
  tmp = createTempDir('projo-analysis-')
})
afterEach(async () => {
  await world.stop()
  tmp.cleanup()
})

const SECOND = 1000

const analysisOf = async (libraryId: string) => {
  const library = (await (await world.request(`/libraries/${libraryId}`)).json()) as LibraryDto
  return { ready: library.sourceCounts.ready, ...library.analysis }
}

const watchPending = async () => {
  world.jobQueue.enqueue({ type: 'watch_pending', payload: {}, dedupeKey: 'watch_pending' })
  await world.runJobs(['watch_pending'])
}

const at = (start: Date, seconds: number) =>
  new Date(start.getTime() + seconds * SECOND).toISOString()

describe('library analysis (§7.2–7.3, §15): quiet period, verification, failures', () => {
  test('each phase is read from the pipeline as the clock moves', async () => {
    const root = tmp.path
    placeVideo(root, 'Alpha (2001).mkv')
    placeVideo(root, 'Beta (2002).mkv')
    placeCorruptedVideo(root, 'Broken (2003).mkv')
    placeGarbage(root, 'Garbage (2004).mkv')
    const downloading = placeGarbage(root, 'Downloading (2005).mkv')

    const created = await world.request('/libraries', {
      method: 'POST',
      json: { name: 'Films', roots: [root], quietPeriodSeconds: 120 },
    })
    const { id } = (await created.json()) as LibraryDto
    const t0 = world.clock.now()
    await world.runJobs(['scan_library'])

    // Discovery over in no time: every file waits for its quiet period, nothing is "up to date".
    expect(await analysisOf(id)).toEqual({
      ready: 0,
      waiting: 5,
      verifying: 0,
      failed: 0,
      nextReadyAt: at(t0, 120),
    })

    // 60 s later, one file is still being written: its counter restarts, the others' does not.
    world.clock.advance(60 * SECOND)
    growFile(downloading)
    await watchPending()
    expect(await analysisOf(id)).toMatchObject({
      waiting: 5,
      verifying: 0,
      nextReadyAt: at(t0, 120),
    })

    // Quiet period over for four files: they are being verified, the fifth still waits.
    world.clock.advance(61 * SECOND)
    await watchPending()
    expect(await analysisOf(id)).toEqual({
      ready: 0,
      waiting: 1,
      verifying: 4,
      failed: 0,
      nextReadyAt: at(t0, 180),
    })

    // Probe and sample decodes: two ready, two unreadable (counted apart, they stay pending).
    await world.runJobs(['probe_source'])
    expect(await analysisOf(id)).toEqual({
      ready: 2,
      waiting: 1,
      verifying: 0,
      failed: 2,
      nextReadyAt: at(t0, 180),
    })

    // The last one settles, then fails its probe: nothing is in progress any more.
    world.clock.advance(60 * SECOND)
    await watchPending()
    expect(await analysisOf(id)).toEqual({ ready: 2, waiting: 0, verifying: 1, failed: 2 })
    await world.runJobs(['probe_source'])
    expect(await analysisOf(id)).toEqual({ ready: 2, waiting: 0, verifying: 0, failed: 3 })

    // Failures are re-tested by each scan without counting as in progress.
    await world.request(`/libraries/${id}/scan`, { method: 'POST', json: { mode: 'quick' } })
    await world.runJobs(['scan_library'])
    expect(await analysisOf(id)).toEqual({ ready: 2, waiting: 0, verifying: 0, failed: 3 })
  })
})
