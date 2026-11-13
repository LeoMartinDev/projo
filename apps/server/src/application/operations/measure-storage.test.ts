import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { t0 } from '../../../test/support/operations-fakes.ts'
import { dataPathsFor } from '../../core/data-paths.ts'
import type { DiskUsage } from '../../core/stats/stats.ts'
import { measureStorageFactory } from './measure-storage.ts'

describe('storage and dashboard (§15)', () => {
  const sizes: Record<string, number> = {
    '/data/db/projo.db': 1000,
    '/data/db/projo.db-wal': 24,
    '/data/images': 5000,
    '/data/cache/transcode': 70,
  }
  const fakeDisk = () => {
    let walks = 0
    const diskUsage: DiskUsage = {
      directorySize: async (path) => {
        walks += 1
        return sizes[path] ?? 0
      },
      fileSystem: async () => ({ totalBytes: 10_000, freeBytes: 4_000 }),
    }
    return { diskUsage, walks: () => walks }
  }

  test('measures each category, then reuses the measure for 5 minutes', async () => {
    const clock = createManualClock(t0)
    const { diskUsage, walks } = fakeDisk()
    const measure = measureStorageFactory({ diskUsage, paths: dataPathsFor('/data'), clock })
    const first = await measure()
    expect(first.categories).toContainEqual({ category: 'database', bytes: 1024 })
    expect(first.categories).toContainEqual({ category: 'images', bytes: 5000 })
    expect(first.categories).toContainEqual({ category: 'transcode', bytes: 70 })
    expect(first).toMatchObject({ totalBytes: 10_000, freeBytes: 4_000, measuredAt: t0 })
    const count = walks()
    clock.advance(4 * 60_000)
    expect(await measure()).toBe(first)
    expect(walks()).toBe(count)
    clock.advance(2 * 60_000)
    expect((await measure()).measuredAt).toEqual(clock.now())
  })
})
