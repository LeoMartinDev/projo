import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  episodeSource,
  localDark,
  movieSource,
  createReviewWorld as setup,
} from '../../../test/support/metadata-review-world.ts'

const hidden = { state: 'rejected', matchState: 'unmatched', reviewReason: undefined } as const

describe('hiding a group (§7.8)', () => {
  test('an unknown file: source/not_found', () => {
    const world = setup({ sources: [] })
    expect(world.rejectSourceGroup({ sourceId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found', context: { id: 'nope' } },
    })
  })

  test('a file not to review: source/not_to_review, nothing written', () => {
    const world = setup({ sources: [movieSource('m1', { matchState: 'manual' })] })
    expect(world.rejectSourceGroup({ sourceId: 'm1' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_to_review', context: { id: 'm1' } },
    })
    expect(world.patches).toEqual([])
    expect(world.timeline).toEqual([])
  })

  test('every file of the series group, in one transaction, unlinked; the rest untouched', () => {
    const dark = localDark([1, 2, 3, 4])
    const world = setup({
      sources: [
        episodeSource(1),
        episodeSource(2),
        episodeSource(3),
        episodeSource(4, { rootId: 'other-root' }),
        movieSource('m1'),
      ],
      ...dark,
    })
    expect(world.rejectSourceGroup({ sourceId: 'e2' })).toEqual(
      ok({ sourceIds: ['e1', 'e2', 'e3'] }),
    )
    expect(world.timeline).toEqual([
      'leaving {"sourceIds":["e1","e2","e3"]}',
      'transaction',
      'settled',
    ])
    expect(world.patches).toEqual(['e1', 'e2', 'e3'].map((id) => ({ id, patch: hidden })))
    expect(['e1', 'e2', 'e3', 'e4'].map((id) => world.items.links.get(id))).toEqual([
      [],
      [],
      [],
      ['l-ep4'],
    ])
    expect(world.sources.get('m1')?.state).toBe('ready')
  })

  test('a file alone is a group of its own', () => {
    const world = setup({ sources: [movieSource('m1'), movieSource('m2')] })
    expect(world.rejectSourceGroup({ sourceId: 'm1' })).toEqual(ok({ sourceIds: ['m1'] }))
    expect(world.sources.get('m2')?.state).toBe('ready')
  })

  test('a file identified meanwhile is left alone', () => {
    const dark = localDark([1, 2])
    const world = setup({ sources: [episodeSource(1), episodeSource(2)], ...dark })
    const transaction = world.items.repo.transaction
    world.items.repo.transaction = (run) => {
      const e2 = world.sources.get('e2')
      if (e2 !== undefined) world.sources.set('e2', { ...e2, matchState: 'manual' })
      return transaction(run)
    }
    expect(world.rejectSourceGroup({ sourceId: 'e1' })).toEqual(ok({ sourceIds: ['e1'] }))
    expect(world.patches.map((patch) => patch.id)).toEqual(['e1'])
    expect(world.items.links.get('e2')).toEqual(['l-ep2'])
  })
})
