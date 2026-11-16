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
      movieSource('a1'),
      episodeSource(1, { reviewReason: 'no_match' }),
      episodeSource(2),
      episodeSource(3),
      movieSource('z1', { libraryId: 'lib-2', reviewReason: 'ambiguous_match' }),
      movieSource('m9', { matchState: 'manual' }),
      episodeSource(9, {
        relativePath: 'Dark/Season 1/Dark Special.mkv',
        parsed: { series: 'Dark' },
      }),
    ],
    ...localDark([1, 2, 3]),
  })

describe('"To review" by series group (§7.8)', () => {
  test('one entry per group in the list order of files, with its first file; total in files', () => {
    const page = world().listReviewGroups({ limit: 50 })
    expect(page.total).toBe(6)
    expect(
      page.items.map(({ group, first }) => [first.id, group.files.map((file) => file.id)]),
    ).toEqual([
      ['z1', ['z1']],
      ['e9', ['e9']],
      ['e1', ['e1', 'e2', 'e3']],
      ['a1', ['a1']],
    ])
    expect(page.items[2]?.group.series).toEqual({ showId: 'l-series', showFolder: 'Dark' })
    expect(page.items[2]?.first).toMatchObject({ id: 'e1', rootPath: '/media', itemIds: ['l-ep1'] })
    expect(page.nextCursor).toBeUndefined()
  })

  test('pages of groups through the cursor', () => {
    const first = world().listReviewGroups({ limit: 2 })
    expect(first.items.map(({ first: file }) => file.id)).toEqual(['z1', 'e9'])
    expect(first.nextCursor).toBe('e9')
    const next = world().listReviewGroups({ limit: 2, cursor: 'e9' })
    expect(next.items.map(({ first: file }) => file.id)).toEqual(['e1', 'a1'])
    expect(next.nextCursor).toBeUndefined()
  })

  test('by library; with a reason, a group keeps its files of that reason', () => {
    const page = world().listReviewGroups({
      libraryId: 'lib',
      reviewReason: 'ambiguous_match',
      limit: 50,
    })
    expect(page.total).toBe(3)
    expect(page.items.map(({ group }) => group.files.map((file) => file.id))).toEqual([
      ['e9'],
      ['e2', 'e3'],
    ])
  })
})
