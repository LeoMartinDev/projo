import { describe, expect, test } from 'bun:test'

import {
  awaitsReview,
  groupForReview,
  pageReviewGroups,
  type ReviewCandidate,
  reviewGroupOf,
  reviewReasonsOf,
} from './review-groups.ts'

const episode = (
  id: string,
  relativePath: string,
  numbers: { season?: number; episode?: number; showId?: string; rootId?: string } = {},
): ReviewCandidate => ({
  id,
  rootId: numbers.rootId ?? 'root',
  relativePath,
  reviewReason: 'no_match',
  episode: {
    showId: numbers.showId ?? 'show',
    showTitle: 'Dragon Ball Super',
    ...(numbers.season === undefined ? {} : { seasonNumber: numbers.season }),
    ...(numbers.episode === undefined ? {} : { episodeNumber: numbers.episode }),
  },
})

const file = (id: string, relativePath: string): ReviewCandidate => ({
  id,
  rootId: 'root',
  relativePath,
  reviewReason: 'no_episode_number',
})

// The list's order: newest id first
const candidates: ReviewCandidate[] = [
  episode('f9', 'DBS/Season 2/DBS S02E01.mkv', { season: 2, episode: 1 }),
  file('f8', 'DBS/Season 1/DBS Special.mkv'),
  episode('f7', 'DBS/Season 1/DBS S01E02.mkv', { season: 1, episode: 2 }),
  episode('f6', 'Movie.mkv'),
  episode('f5', 'Copy/DBS/Season 1/DBS S01E01.mkv', { season: 1, episode: 1 }),
  episode('f4', 'DBS/Season 1/DBS S01E01.mkv', { season: 1, episode: 1, rootId: 'other' }),
  episode('f3', 'DBS/Season 1/DBS S01E01.mkv', { season: 1, episode: 1 }),
  episode('f2', 'DBS/Season 1/Other S01E01.mkv', { season: 1, episode: 1, showId: 'other' }),
  file('f1', 'Film.mkv'),
]

describe('series groups of "To review" (§7.8)', () => {
  test('same show, same root, same show folder; anything else stands alone', () => {
    const groups = groupForReview(candidates)
    expect(groups.map((group) => group.files.map((one) => one.id))).toEqual([
      ['f3', 'f7', 'f9'],
      ['f8'],
      ['f6'],
      ['f5'],
      ['f4'],
      ['f2'],
      ['f1'],
    ])
    expect(groups[0]?.series).toEqual({
      showId: 'show',
      title: 'Dragon Ball Super',
      showFolder: 'DBS',
    })
    expect(groups[1]?.series).toBeUndefined()
  })

  test('first file: lowest season, then episode, then path', () => {
    const group = groupForReview([
      episode('b', 'S/Season 1/b.mkv', { season: 1, episode: 3 }),
      episode('c', 'S/Season 1/a.mkv', { season: 1, episode: 3 }),
      episode('a', 'S/Season 1/z.mkv', { season: 1, episode: 1 }),
    ])[0]
    expect(group?.files.map((one) => one.id)).toEqual(['a', 'c', 'b'])
  })

  test('the group of one file, or none for a file not to review', () => {
    expect(reviewGroupOf(candidates, 'f7')?.files.map((one) => one.id)).toEqual(['f3', 'f7', 'f9'])
    expect(reviewGroupOf(candidates, 'f8')?.files.map((one) => one.id)).toEqual(['f8'])
    expect(reviewGroupOf(candidates, 'nope')).toBeUndefined()
  })

  test('pages of groups follow the cursor of their earliest file', () => {
    const first = pageReviewGroups(candidates, { limit: 2 })
    expect(first.groups.map((group) => group.files[0]?.id)).toEqual(['f3', 'f8'])
    expect(first.nextCursor).toBe('f8')
    const second = pageReviewGroups(candidates, { limit: 4, cursor: 'f8' })
    expect(second.groups.map((group) => group.files[0]?.id)).toEqual(['f6', 'f5', 'f4', 'f2'])
    expect(second.nextCursor).toBe('f2')
    const last = pageReviewGroups(candidates, { limit: 4, cursor: 'f2' })
    expect(last.groups.map((group) => group.files[0]?.id)).toEqual(['f1'])
    expect(last.nextCursor).toBeUndefined()
  })

  test('reasons with their counts, most frequent first', () => {
    expect(
      reviewReasonsOf({
        files: [
          { ...file('a', 'a'), reviewReason: 'episode_not_found' },
          { ...file('b', 'b'), reviewReason: 'no_match' },
          { ...file('c', 'c'), reviewReason: 'no_match' },
        ],
      }),
    ).toEqual([
      { reason: 'no_match', count: 2 },
      { reason: 'episode_not_found', count: 1 },
    ])
  })

  test('a file awaits review when ready and needs_review', () => {
    expect(awaitsReview({ state: 'ready', matchState: 'needs_review' })).toBe(true)
    expect(awaitsReview({ state: 'pending', matchState: 'needs_review' })).toBe(false)
    expect(awaitsReview({ state: 'ready', matchState: 'manual' })).toBe(false)
  })
})
