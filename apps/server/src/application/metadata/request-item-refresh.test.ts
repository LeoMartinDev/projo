import { describe, expect, test } from 'bun:test'

import {
  notFound,
  createEditingWorld as setup,
} from '../../../test/support/metadata-editing-world.ts'

describe('refreshing from TMDB (§9.4)', () => {
  test('an item: one deduplicated refresh job', () => {
    const world = setup()
    const result = world.requestItemRefresh({ itemId: 'movie' })
    expect(result.ok && result.value).toMatchObject({ type: 'refresh_metadata', state: 'queued' })
    expect(world.enqueued).toEqual([
      { type: 'refresh_metadata', payload: { itemId: 'movie' }, dedupeKey: 'refresh:movie' },
    ])
  })

  test('an unknown item: item/not_found; a local one: metadata/not_matched', () => {
    const world = setup()
    expect(world.requestItemRefresh({ itemId: 'nope' })).toMatchObject(notFound)
    expect(world.requestItemRefresh({ itemId: 'local' })).toMatchObject({
      ok: false,
      error: { code: 'metadata/not_matched' },
    })
    expect(world.enqueued).toEqual([])
  })
})
