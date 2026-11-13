import { expect, test } from 'bun:test'

import {
  catalogItem,
  inMemoryItems,
  inMemorySources,
  library,
  source,
} from '../../../test/support/assistant-fakes.ts'
import { getItemFilesFactory } from './get-item-files.ts'

const getItemFiles = getItemFilesFactory({
  sources: inMemorySources([
    source('s1', { relativePath: 'Ours/e1.mkv' }),
    source('s2', { relativePath: 'Ours/e2.mkv', libraryId: 'lib-2' }),
  ]).sources,
  libraries: { list: () => [library('lib-1', 'Shows')] },
  items: inMemoryItems({
    items: [
      { id: 'show', kind: 'series', tmdbId: 42 },
      { id: 'hidden', kind: 'movie' },
    ],
    links: [
      { itemId: 'show', sourceId: 's1', seasonNumber: 1, episodeNumber: 1 },
      { itemId: 'show', sourceId: 's2', seasonNumber: 1, episodeNumber: 2 },
      { itemId: 'show', sourceId: 'gone' },
    ],
  }),
  catalog: {
    findVisible: ({ id }) =>
      id === 'show'
        ? catalogItem('show', { kind: 'series', title: 'Ours', year: 2020 })
        : undefined,
  },
})

test('lists the files of an item with their library and episode numbers', () => {
  const result = getItemFiles({ itemId: 'show' })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  const { files, ...item } = result.value
  expect(item).toEqual({ id: 'show', kind: 'series', title: 'Ours', year: 2020, tmdbId: 42 })
  expect(files.map(({ source: { id }, ...rest }) => ({ id, ...rest }))).toEqual([
    { id: 's1', library: 'Shows', seasonNumber: 1, episodeNumber: 1 },
    { id: 's2', library: undefined, seasonNumber: 1, episodeNumber: 2 },
  ])
})

test('describes an item missing from the catalogue read model by its metadata only', () => {
  expect(getItemFiles({ itemId: 'hidden' })).toEqual({
    ok: true,
    value: { id: 'hidden', kind: 'movie', files: [] },
  })
})

test('refuses an unknown item', () => {
  expect(getItemFiles({ itemId: 'nope' })).toMatchObject({
    ok: false,
    error: { code: 'item/not_found', context: { id: 'nope' } },
  })
})
