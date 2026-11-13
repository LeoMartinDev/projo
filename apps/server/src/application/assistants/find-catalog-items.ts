import { type CatalogItem, type CatalogReadModel, everything } from '../../core/catalog/catalog.ts'
import { toSearchExpression } from '../../core/catalog/search.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'

type Deps = {
  catalog: Pick<CatalogReadModel, 'search'>
  items: Pick<MetadataItemRepository, 'findItem' | 'sourcesUnder'>
}

export type FoundCatalogItem = { item: CatalogItem; tmdbId?: number; files: number }

const searchLimit = 30

export const findCatalogItemsFactory =
  ({ catalog, items }: Deps) =>
  ({ query }: { query: string }): FoundCatalogItem[] => {
    const expression = toSearchExpression(query)
    if (expression === undefined) return []
    return catalog.search({ expression, limit: searchLimit, scope: everything }).map((item) => {
      const tmdbId = items.findItem(item.id)?.tmdbId
      return {
        item,
        ...(tmdbId === undefined ? {} : { tmdbId }),
        files: items.sourcesUnder(item.id).length,
      }
    })
  }

export type FindCatalogItems = ReturnType<typeof findCatalogItemsFactory>
