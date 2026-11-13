import { expect, test } from 'bun:test'

import {
  catalogItem,
  inMemoryItems,
  inMemorySources,
  library,
  source,
} from '../../../test/support/assistant-fakes.ts'
import { getReviewSourceFactory } from './get-review-source.ts'

const rows = [
  source('e1', { relativePath: 'Ours/Season 1/e1.mkv' }),
  source('e2', { relativePath: 'Ours/Season 1/e2.mkv', reviewReason: 'episode_not_found' }),
  source('e9', { relativePath: 'Ours/Season 2/e9.mkv' }),
  source('other-root', { relativePath: 'Ours/Season 1/e3.mkv', rootId: 'root-2' }),
  source('other-show', { relativePath: 'Theirs/e1.mkv' }),
  source('done', { relativePath: 'Ours/Season 1/e4.mkv', matchState: 'matched' }),
]

const getReviewSource = getReviewSourceFactory({
  sources: inMemorySources(rows).sources,
  libraries: { list: () => [library('lib-1', 'Shows')] },
  items: inMemoryItems({
    items: [
      { id: 'show', kind: 'series' },
      { id: 'season', kind: 'season', parentId: 'show', seasonNumber: 1 },
      { id: 'episode', kind: 'episode', parentId: 'season', tmdbId: 7, episodeNumber: 1 },
    ],
    links: [
      { itemId: 'episode', sourceId: 'e1' },
      { itemId: 'ghost', sourceId: 'e1' },
    ],
  }),
  catalog: {
    findVisible: ({ id }) =>
      id === 'episode' ? catalogItem('episode', { kind: 'episode', title: 'Pilot' }) : undefined,
  },
})

test('describes the file, the items it sits under and its neighbours to review', () => {
  const result = getReviewSource({ sourceId: 'e1' })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.source.id).toBe('e1')
  expect(result.value.library).toBe('Shows')
  expect(result.value.items).toEqual([
    { id: 'episode', kind: 'episode', title: 'Pilot', tmdbId: 7, episodeNumber: 1 },
  ])
  expect(result.value.sameFolderToReview.map((other) => other.id)).toEqual(['e2', 'e9'])
})

test('refuses an unknown source', () => {
  expect(getReviewSource({ sourceId: 'nope' })).toMatchObject({
    ok: false,
    error: { code: 'source/not_found', context: { id: 'nope' } },
  })
})
