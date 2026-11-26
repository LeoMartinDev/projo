import { describe, expect, test } from 'bun:test'

import { ok } from '@projo/shared'

import type { ItemKind } from '../../core/catalog/catalog.ts'
import type { CatalogSeasonRow } from '../../core/metadata/catalog-items.ts'
import { listSeriesSeasonsFactory } from './list-series-seasons.ts'

const seasons: CatalogSeasonRow[] = [
  {
    id: 'mad-men-s1',
    seasonNumber: 1,
    locked: [],
    episodes: [
      { id: 'mad-men-s1e1', episodeNumber: 1, files: { ready: 1, missing: 0 }, locked: ['title'] },
    ],
  },
]

const kinds: Record<string, ItemKind> = { 'mad-men': 'series', alien: 'movie' }

const listSeriesSeasons = listSeriesSeasonsFactory({
  catalogItems: {
    kindOf: (itemId) => kinds[itemId],
    seasons: (seriesId) => (seriesId === 'mad-men' ? seasons : []),
  },
})

describe("a show's seasons in Media › Catalogue (§15)", () => {
  test('its seasons with their episodes', () => {
    expect(listSeriesSeasons({ itemId: 'mad-men' })).toEqual(ok(seasons))
  })

  test('an unknown item: item/not_found', () => {
    expect(listSeriesSeasons({ itemId: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'item/not_found' },
    })
  })

  test('a movie has none: item/invalid_kind', () => {
    expect(listSeriesSeasons({ itemId: 'alien' })).toMatchObject({
      ok: false,
      error: { code: 'item/invalid_kind', context: { kind: 'movie' } },
    })
  })
})
