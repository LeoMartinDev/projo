import { describe, expect, test } from 'bun:test'

import { silentLogger } from '../../../test/support/logger.ts'
import type { StoredImage } from '../../core/metadata/ports.ts'
import { purgeUnusedImagesFactory } from './purge-unused-images.ts'

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
})
