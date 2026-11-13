import { expect, test } from 'bun:test'

import { inMemorySources, library, source } from '../../../test/support/assistant-fakes.ts'
import { listHiddenSourcesFactory } from './list-hidden-sources.ts'

test('lists the hidden files only, with their library name', () => {
  const { sources, queries } = inMemorySources([
    source('a', { relativePath: 'sample.mkv', state: 'rejected' }),
    source('b', { relativePath: 'Show/b.mkv' }),
  ])
  const list = listHiddenSourcesFactory({
    sources,
    libraries: { list: () => [library('lib-1', 'Shows')] },
  })

  const page = list({ limit: 50, cursor: 'c' })

  expect(page.total).toBe(1)
  expect(page.items.map(({ source: { id }, library: name }) => [id, name])).toEqual([
    ['a', 'Shows'],
  ])
  expect(queries).toEqual([{ state: 'rejected', limit: 50, cursor: 'c' }])
})
