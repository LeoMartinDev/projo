import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  movieSource,
  createReviewWorld as setup,
} from '../../../test/support/metadata-review-world.ts'

describe('hiding a file', () => {
  test('an unknown file: source/not_found', () => {
    const world = setup({ sources: [] })
    expect(world.rejectSource({ sourceId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
  })

  test('rejected, unlinked in one transaction, the deciding library settled afterwards', () => {
    const world = setup({ sources: [movieSource('m1')], links: { m1: ['item-1'] } })
    expect(world.rejectSource({ sourceId: 'm1' })).toEqual(ok())
    expect(world.timeline).toEqual(['leaving {"sourceIds":["m1"]}', 'transaction', 'settled'])
    expect(world.patches).toEqual([
      { id: 'm1', patch: { state: 'rejected', matchState: 'unmatched', reviewReason: undefined } },
    ])
    expect(world.items.links.get('m1')).toEqual([])
  })
})
