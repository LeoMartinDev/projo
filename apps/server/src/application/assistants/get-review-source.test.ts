import { expect, test } from 'bun:test'

import {
  catalogItem,
  inMemoryItems,
  inMemorySources,
  library,
  source,
} from '../../../test/support/assistant-fakes.ts'
import { inMemoryReviewQueue } from '../../../test/support/review-queue-fakes.ts'
import type { LinkedItemInfo } from '../../core/metadata/linking.ts'
import { getReviewSourceFactory } from './get-review-source.ts'

const rows = [
  source('e1', { relativePath: 'Ours/Season 1/e1.mkv' }),
  source('e2', { relativePath: 'Ours/Season 1/e2.mkv', reviewReason: 'episode_not_found' }),
  source('e9', { relativePath: 'Ours/Season 2/e9.mkv' }),
  source('extra', { relativePath: 'Ours/Season 1/extra.mkv', reviewReason: 'no_episode_number' }),
  source('other-root', { relativePath: 'Ours/Season 1/e3.mkv', rootId: 'root-2' }),
  source('other-show', { relativePath: 'Theirs/e1.mkv' }),
  source('done', { relativePath: 'Ours/Season 1/e4.mkv', matchState: 'matched' }),
  source('other-library', { relativePath: 'Ours/Season 1/e5.mkv', libraryId: 'lib-2' }),
]

const items: LinkedItemInfo[] = [
  { id: 'show', kind: 'series' },
  { id: 'season', kind: 'season', parentId: 'show', seasonNumber: 1 },
  { id: 'season-2', kind: 'season', parentId: 'show', seasonNumber: 2 },
  { id: 'episode', kind: 'episode', parentId: 'season', tmdbId: 7, episodeNumber: 1 },
  { id: 'episode-2', kind: 'episode', parentId: 'season', seasonNumber: 1, episodeNumber: 2 },
  { id: 'episode-9', kind: 'episode', parentId: 'season-2', seasonNumber: 2, episodeNumber: 1 },
  { id: 'episode-3', kind: 'episode', parentId: 'season', seasonNumber: 1, episodeNumber: 3 },
]
const links = [
  { itemId: 'episode', sourceId: 'e1' },
  { itemId: 'ghost', sourceId: 'e1' },
  { itemId: 'episode-2', sourceId: 'e2' },
  { itemId: 'episode-9', sourceId: 'e9' },
  { itemId: 'episode-3', sourceId: 'other-root' },
]

const { sources } = inMemorySources(rows)

const getReviewSource = getReviewSourceFactory({
  sources,
  reviewQueue: inMemoryReviewQueue({
    sources: () => rows,
    item: (id) => items.find((item) => item.id === id),
    linksOf: (sourceId) =>
      links.filter((link) => link.sourceId === sourceId).map((link) => link.itemId),
  }),
  libraries: { list: () => [library('lib-1', 'Shows')] },
  items: inMemoryItems({ items, links }),
  visibleItems: {
    findVisible: ({ id }) =>
      id === 'episode' ? catalogItem('episode', { kind: 'episode', title: 'Pilot' }) : undefined,
  },
})

test('describes the file, the items it sits under, its series group and its folder', () => {
  const result = getReviewSource({ sourceId: 'e1' })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.source.id).toBe('e1')
  expect(result.value.library).toBe('Shows')
  expect(result.value.items).toEqual([
    { id: 'episode', kind: 'episode', title: 'Pilot', tmdbId: 7, episodeNumber: 1 },
  ])
  expect(result.value.seriesGroup.map((other) => other.id)).toEqual(['e1', 'e2', 'e9'])
  expect(result.value.sameFolderToReview.map((other) => other.id)).toEqual(['extra'])
})

test('a file alone is its own group', () => {
  const result = getReviewSource({ sourceId: 'extra' })
  expect(result.ok && result.value.seriesGroup.map((other) => other.id)).toEqual(['extra'])
  expect(result.ok && result.value.sameFolderToReview.map((other) => other.id)).toEqual([
    'e2',
    'e1',
  ])
})

test('a file no longer to review has no group', () => {
  const result = getReviewSource({ sourceId: 'done' })
  expect(result.ok && result.value.seriesGroup).toEqual([])
})

test('refuses an unknown source', () => {
  expect(getReviewSource({ sourceId: 'nope' })).toMatchObject({
    ok: false,
    error: { code: 'source/not_found', context: { id: 'nope' } },
  })
})
