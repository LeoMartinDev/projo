import { expect, test } from 'bun:test'

import { inMemorySources, library, source } from '../../../test/support/assistant-fakes.ts'
import { listReviewQueueFactory } from './list-review-queue.ts'

const rows = [
  source('a', { relativePath: 'Show/a.mkv', reviewReason: 'no_match' }),
  source('b', { relativePath: 'Show/b.mkv', reviewReason: 'ambiguous_match' }),
  source('c', { relativePath: 'Film.mkv', matchState: 'matched' }),
  source('d', { relativePath: 'Other/d.mkv', libraryId: 'lib-2', reviewReason: 'no_match' }),
]

const setup = () => {
  const { sources, queries } = inMemorySources(rows)
  const list = listReviewQueueFactory({
    sources,
    libraries: { list: () => [library('lib-1', 'Shows')] },
  })
  return { list, queries }
}

test('lists the ready files waiting for review, with their library name', () => {
  const { list } = setup()

  const page = list({ limit: 10 })

  expect(page.total).toBe(3)
  expect(page.items.map(({ source: { id }, library: name }) => [id, name])).toEqual([
    ['a', 'Shows'],
    ['b', 'Shows'],
    ['d', undefined],
  ])
  expect(page.nextCursor).toBeUndefined()
})

test('passes the library, reason and cursor filters to the repository', () => {
  const { list, queries } = setup()

  const page = list({ libraryId: 'lib-1', reason: 'no_match', cursor: 'x', limit: 5 })

  expect(page.items.map(({ source: { id } }) => id)).toEqual(['a'])
  expect(queries).toEqual([
    {
      state: 'ready',
      matchState: 'needs_review',
      limit: 5,
      libraryId: 'lib-1',
      reviewReason: 'no_match',
      cursor: 'x',
    },
  ])
})

test('returns the next cursor of a partial page', () => {
  const { list } = setup()

  expect(list({ limit: 1 }).nextCursor).toBe('a')
})
