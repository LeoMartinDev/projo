import { expect, test } from 'bun:test'

import { everything } from '../../core/catalog/catalog.ts'
import { catalogItem, inMemoryItems } from '../../../test/support/assistant-fakes.ts'
import { findCatalogItemsFactory } from './find-catalog-items.ts'

const setup = () => {
  const searches: unknown[] = []
  const find = findCatalogItemsFactory({
    catalogReadModel: {
      search: (input) => {
        searches.push(input)
        return [
          catalogItem('show', { kind: 'series', title: 'Ours' }),
          catalogItem('local', { kind: 'movie', title: 'Ours, the film' }),
        ]
      },
    },
    items: inMemoryItems({
      items: [
        { id: 'show', kind: 'series', tmdbId: 42 },
        { id: 'season', kind: 'season', parentId: 'show', seasonNumber: 1 },
        { id: 'e1', kind: 'episode', parentId: 'season', seasonNumber: 1, episodeNumber: 1 },
        { id: 'e2', kind: 'episode', parentId: 'season', seasonNumber: 1, episodeNumber: 2 },
        { id: 'local', kind: 'movie' },
      ],
      links: [
        { itemId: 'e1', sourceId: 's1' },
        { itemId: 'e2', sourceId: 's1' },
        { itemId: 'e2', sourceId: 's2' },
      ],
    }),
  })
  return { find, searches }
}

test('finds titles across the whole catalogue with their TMDB id and file count', () => {
  const { find, searches } = setup()

  const found = find({ query: 'ours' })

  expect(found.map(({ item, ...rest }) => ({ id: item.id, ...rest }))).toEqual([
    { id: 'show', tmdbId: 42, files: 2 },
    { id: 'local', files: 0 },
  ])
  expect(searches).toMatchObject([{ limit: 30, scope: everything }])
})

test('finds nothing for a query without searchable words', () => {
  const { find, searches } = setup()

  expect(find({ query: '"' })).toEqual([])
  expect(searches).toEqual([])
})
