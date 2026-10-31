import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import type { StoredImage } from '../../core/metadata/ports.ts'
import { purgeTmdbResponsesFactory, purgeUnusedImagesFactory } from './metadata-retention.ts'

const image = (id: string): StoredImage => ({
  id,
  kind: 'poster',
  origin: 'tmdb',
  localPath: `posters/${id}.jpg`,
  width: 500,
  height: 750,
})

describe('metadata retention (§18 "Rules")', () => {
  test('unused images go with their files; one used again meanwhile stays', async () => {
    const rows = new Map(['a', 'b'].map((id) => [id, image(id)]))
    const removedFiles: string[] = []
    const purge = purgeUnusedImagesFactory({
      images: {
        listUnused: () => ['a', 'b'],
        // `b` got a reference between the listing and its deletion.
        deleteIfUnused: (id) => {
          const row = id === 'b' ? undefined : rows.get(id)
          if (row !== undefined) rows.delete(id)
          return row
        },
      },
      files: { remove: async (path) => void removedFiles.push(path) },
      logger: silentLogger,
    })
    expect(await purge()).toEqual({ removed: 1 })
    expect(removedFiles).toEqual(['posters/a.jpg'])
    expect([...rows.keys()]).toEqual(['b'])
  })

  test('TMDB responses older than the longest age a reader accepts (30 days)', () => {
    const now = new Date('2026-10-31T00:00:00.000Z')
    const asked: Date[] = []
    const purge = purgeTmdbResponsesFactory({
      responses: { purgeFetchedBefore: (before) => (asked.push(before), 3) },
      clock: createManualClock(now),
      logger: silentLogger,
    })
    expect(purge()).toEqual({ deleted: 3 })
    expect(asked).toEqual([new Date('2026-10-01T00:00:00.000Z')])
  })
})
