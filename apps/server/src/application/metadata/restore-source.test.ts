import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import {
  library,
  movieSource,
  now,
  readyAt,
  createReviewWorld as setup,
} from '../../../test/support/metadata-review-world.ts'

describe('showing a hidden file again', () => {
  test('an unknown file: source/not_found', () => {
    const world = setup({ sources: [] })
    expect(world.restoreSource({ sourceId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
  })

  test('a file that is not hidden: source/not_rejected', () => {
    const world = setup({ sources: [movieSource('m1')] })
    expect(world.restoreSource({ sourceId: 'm1' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_rejected', context: { id: 'm1', state: 'ready' } },
    })
    expect(world.patches).toEqual([])
  })

  test('read again from its name, pending, and probed again first', () => {
    const world = setup({
      sources: [
        movieSource('m1', {
          relativePath: 'Inception (2010).mkv',
          state: 'rejected',
          matchState: 'unmatched',
          reviewReason: undefined,
          stableSince: readyAt,
        }),
      ],
      libraries: [library({ hint: 'movies' })],
    })
    expect(world.restoreSource({ sourceId: 'm1' })).toEqual(ok())
    expect(world.patches).toEqual([
      {
        id: 'm1',
        patch: {
          state: 'pending',
          pendingReason: 'growing',
          pendingSince: now,
          unchangedSince: now,
          stableSince: undefined,
          classification: 'movie',
          parsed: { title: 'Inception', year: 2010 },
          matchState: 'unmatched',
          reviewReason: undefined,
        },
      },
    ])
    expect(world.enqueued).toMatchObject([
      {
        type: 'probe_source',
        payload: { sourceId: 'm1', mode: 'recheck' },
        dedupeKey: 'source:m1',
        priority: 80,
      },
    ])
  })

  test('a file below the video size waits as too small', () => {
    const world = setup({
      sources: [movieSource('m1', { state: 'rejected', sizeBytes: 1000 })],
    })
    world.restoreSource({ sourceId: 'm1' })
    expect(world.patches[0]?.patch.pendingReason).toBe('too_small')
  })

  test('a name that needs review goes back to review with its reason', () => {
    const world = setup({
      sources: [
        movieSource('e1', {
          relativePath: 'Shows/Dark/Season 1/random clip.mkv',
          state: 'rejected',
          matchState: 'unmatched',
        }),
      ],
      libraries: [library({ hint: 'series' })],
    })
    world.restoreSource({ sourceId: 'e1' })
    expect(world.patches[0]?.patch).toMatchObject({
      classification: 'episode',
      matchState: 'needs_review',
      reviewReason: 'no_episode_number',
    })
  })
})
