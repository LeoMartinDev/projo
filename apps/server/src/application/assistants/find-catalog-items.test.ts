import { expect, test } from 'bun:test'

import { everything } from '../../core/catalog/catalog.ts'
import { catalogItem, inMemoryItems } from '../../../test/support/assistant-fakes.ts'
import { findCatalogItemsFactory } from './find-catalog-items.ts'

const setup = () => {
  const searches: unknown[] = []
  const find = findCatalogItemsFactory({
    catalog: {
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
        { id: 'local', kind: 'movie' },
      ],
      links: [
        { itemId: 'show', sourceId: 's1', seasonNumber: 1, episodeNumber: 1 },
        { itemId: 'show', sourceId: 's2', seasonNumber: 1, episodeNumber: 2 },
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
