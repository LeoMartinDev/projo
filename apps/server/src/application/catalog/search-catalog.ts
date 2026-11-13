import type { CatalogReadModel, VisibilityScope } from '../../core/catalog/catalog.ts'
import { searchRules, toSearchExpression } from '../../core/catalog/search.ts'
import type { CatalogEntries, CatalogEntry } from './shared/catalog-entries.ts'

type Deps = { catalogReadModel: Pick<CatalogReadModel, 'search'>; catalogEntries: CatalogEntries }

export type SearchResults = { movies: CatalogEntry[]; series: CatalogEntry[] }

export const searchCatalogFactory =
  ({ catalogReadModel, catalogEntries }: Deps) =>
  async ({
    query,
    profileId,
    scope,
  }: {
    query: string
    profileId: string
    scope: VisibilityScope
  }): Promise<SearchResults> => {
    const expression = toSearchExpression(query)
    if (expression === undefined) return { movies: [], series: [] }
    const found = catalogReadModel.search({ expression, limit: searchRules.maxResults, scope })
    const entries = catalogEntries({ profileId, items: found, scope })
    return {
      movies: entries.filter((entry) => entry.item.kind === 'movie'),
      series: entries.filter((entry) => entry.item.kind === 'series'),
    }
  }

export type SearchCatalog = ReturnType<typeof searchCatalogFactory>
