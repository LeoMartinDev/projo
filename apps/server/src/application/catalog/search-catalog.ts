import type { CatalogRepository, VisibilityScope } from '../../core/catalog/catalog.ts'
import { searchRules, toSearchExpression } from '../../core/catalog/search.ts'
import type { CatalogEntries, CatalogEntry } from './catalog-entries.ts'

type Deps = { catalogRepository: CatalogRepository; catalogEntries: CatalogEntries }

export type SearchResults = { movies: CatalogEntry[]; series: CatalogEntry[] }

/** `GET /search?q=` (§13.5): best 30 visible matches, movies and series apart. */
export const searchCatalogFactory =
  ({ catalogRepository, catalogEntries }: Deps) =>
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
    const found = catalogRepository.search({ expression, limit: searchRules.maxResults, scope })
    const entries = catalogEntries({ profileId, items: found, scope })
    return {
      movies: entries.filter((entry) => entry.item.kind === 'movie'),
      series: entries.filter((entry) => entry.item.kind === 'series'),
    }
  }

export type SearchCatalog = ReturnType<typeof searchCatalogFactory>
