import { describe, expect, test } from 'bun:test'

import {
  episodeSource,
  localDark,
  movieSource,
  createReviewWorld as setup,
} from '../../../test/support/metadata-review-world.ts'

const world = () =>
  setup({
    sources: [
      episodeSource(3),
      episodeSource(1),
      episodeSource(2, { state: 'missing' }),
      movieSource('m1'),
      movieSource('m2', { matchState: 'manual' }),
    ],
    ...localDark([1, 2, 3]),
  })

describe('the files of a series group (§7.8)', () => {
  test('first file first, only the files to review', () => {
    const result = world().getReviewGroup({ sourceId: 'e3' })
    expect(result.ok && result.value.files.map((file) => file.id)).toEqual(['e1', 'e3'])
    expect(result.ok && result.value.group.series?.showFolder).toBe('Dark')
  })

  test('a file alone', () => {
    const result = world().getReviewGroup({ sourceId: 'm1' })
    expect(result.ok && result.value.files.map((file) => file.id)).toEqual(['m1'])
  })

  test('an unknown file, a file not to review', () => {
    expect(world().getReviewGroup({ sourceId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_found' },
    })
    expect(world().getReviewGroup({ sourceId: 'm2' })).toMatchObject({
      ok: false,
      error: { code: 'source/not_to_review', context: { id: 'm2' } },
    })
  })
})
