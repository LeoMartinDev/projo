import { expect, test } from 'bun:test'

import { inMemorySources, library, source } from '../../../test/support/assistant-fakes.ts'
import { inMemoryReviewQueue } from '../../../test/support/review-queue-fakes.ts'
import type { LinkedItemInfo } from '../../core/metadata/linking.ts'
import { listReviewGroupsFactory } from '../metadata/list-review-groups.ts'
import { listReviewQueueFactory } from './list-review-queue.ts'

const rows = [
  source('a', { relativePath: 'Show/Season 1/a.mkv', reviewReason: 'no_match' }),
  source('b', { relativePath: 'Show/Season 1/b.mkv', reviewReason: 'ambiguous_match' }),
  source('c', { relativePath: 'Film.mkv', matchState: 'matched' }),
  source('d', { relativePath: 'Other/d.mkv', libraryId: 'lib-2', reviewReason: 'no_match' }),
]
const items: (LinkedItemInfo & { title?: string })[] = [
  { id: 'show', kind: 'series', title: 'Show' },
  { id: 'season', kind: 'season', parentId: 'show', seasonNumber: 1 },
  { id: 'ep1', kind: 'episode', parentId: 'season', seasonNumber: 1, episodeNumber: 1 },
  { id: 'ep2', kind: 'episode', parentId: 'season', seasonNumber: 1, episodeNumber: 2 },
]
const links: Record<string, string[]> = { a: ['ep2'], b: ['ep1'] }

const list = listReviewQueueFactory({
  listReviewGroups: listReviewGroupsFactory({
    reviewQueue: inMemoryReviewQueue({
      sources: () => rows,
      item: (id) => items.find((item) => item.id === id),
      linksOf: (sourceId) => links[sourceId] ?? [],
    }),
    sourceRepository: inMemorySources(rows).sources,
  }),
  libraries: { list: () => [library('lib-1', 'Shows')] },
})

test('lists the series groups to review with their first file and library name', () => {
  const page = list({ limit: 10 })

  expect(page.total).toBe(3)
  expect(
    page.items.map(({ group, first, library: name }) => [
      first.id,
      group.files.map((file) => file.id),
      name,
    ]),
  ).toEqual([
    ['d', ['d'], undefined],
    ['b', ['b', 'a'], 'Shows'],
  ])
  expect(page.items[1]?.group.series).toEqual({ showId: 'show', title: 'Show', showFolder: 'Show' })
  expect(page.nextCursor).toBeUndefined()
})

test('filters by library and reason: a group keeps its files of that reason', () => {
  const page = list({ libraryId: 'lib-1', reason: 'no_match', limit: 5 })

  expect(page.total).toBe(1)
  expect(page.items.map(({ group }) => group.files.map((file) => file.id))).toEqual([['a']])
})

test('returns the next cursor of a partial page', () => {
  const first = list({ limit: 1 })
  expect(first.nextCursor).toBe('d')
  expect(list({ limit: 1, cursor: 'd' }).items.map(({ first: file }) => file.id)).toEqual(['b'])
})
