import { describe, expect, test } from 'bun:test'

import {
  lowPriorityRefresh as low,
  createMetadataRefreshWorld as setup,
} from '../../../test/support/metadata-refresh-world.ts'

describe('refresh queued on a change of language or rating country (§9.4)', () => {
  test('files leaving: the trees whose deciding country changed or that became stale', () => {
    const world = setup({
      withFiles: ['a', 'b', 'c', 'gone'],
      trees: {
        a: { ratingCountry: 'FR', stale: false },
        b: { ratingCountry: 'FR', stale: false },
        c: { ratingCountry: 'FR', stale: false },
        gone: { ratingCountry: 'FR', stale: false },
      },
    })
    const settle = world.observeLeavingFiles({ libraryId: 'kids' })
    world.trees['a'] = { ratingCountry: 'US', stale: false }
    world.trees['b'] = { ratingCountry: 'FR', stale: true }
    delete world.trees['gone']
    expect(settle()).toBe(2)
    expect(world.refreshes()).toEqual([low('a'), low('b')])
  })

  test('files leaving: nothing held, nothing looked at again', () => {
    const world = setup({ trees: { a: { ratingCountry: 'US', stale: true } } })
    expect(world.observeLeavingFiles({ sourceIds: ['s'] })()).toBe(0)
    expect(world.refreshes()).toEqual([])
  })
})
