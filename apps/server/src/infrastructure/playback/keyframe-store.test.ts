import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createTempDir } from '../../../test/support/database.ts'
import { createFileKeyframeStore } from './keyframe-store.ts'

let temp: ReturnType<typeof createTempDir> | undefined
afterEach(() => temp?.cleanup())

describe('createFileKeyframeStore', () => {
  test('lists the indexes on disk and removes one (media-assets-cleanup)', () => {
    temp = createTempDir()
    const store = createFileKeyframeStore({ keyframesDir: temp.path })
    expect(store.listSourceIds()).toEqual([])
    const index = { durationS: 10, keyframes: [0, 5], sizeBytes: 1, mtime: 1 }
    expect(store.write('source-1', index).ok).toBe(true)
    expect(store.write('source-2', index).ok).toBe(true)
    // Not an index of the cache: never listed.
    writeFileSync(join(temp.path, 'notes.txt'), '')
    expect(store.listSourceIds().sort()).toEqual(['source-1', 'source-2'])
    store.remove('source-1')
    expect(store.listSourceIds()).toEqual(['source-2'])
    expect(store.read('source-1')).toBeUndefined()
  })
})
