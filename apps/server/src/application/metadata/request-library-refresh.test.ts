import { describe, expect, test } from 'bun:test'

import { createEditingWorld as setup } from '../../../test/support/metadata-editing-world.ts'
import type { Library } from '../../core/library/library.ts'

describe('refreshing from TMDB (§9.4)', () => {
  test('a library: one low-priority job, deduplicated per library', () => {
    const world = setup({
      libraries: [{ id: 'lib' } as Library],
    })
    expect(world.requestLibraryRefresh({ libraryId: 'lib' }).ok).toBe(true)
    expect(world.enqueued).toEqual([
      {
        type: 'refresh_metadata',
        payload: { libraryId: 'lib' },
        dedupeKey: 'library-refresh:lib',
        priority: 10,
      },
    ])
  })

  test('an unknown library: library/not_found', () => {
    const world = setup()
    expect(world.requestLibraryRefresh({ libraryId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'library/not_found', context: { libraryId: 'nope' } },
    })
    expect(world.enqueued).toEqual([])
  })
})
