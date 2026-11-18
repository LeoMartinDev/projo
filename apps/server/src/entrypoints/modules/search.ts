import type { SearchCatalog } from '../../application/catalog/search-catalog.ts'
import type { SearchTv } from '../../application/tv/search-tv.ts'
import type { VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import { searchRoutes } from '../http/routes/search.ts'
import { defineModule } from './types.ts'

/**
 * `GET /search` (§13.5): the catalogue's titles and the TV's channels and programmes (§29.6).
 * Each part comes from the module that owns it (catalog, tv), so this module builds nothing of
 * its own; it is built after both.
 */
export const buildSearchModule = (deps: {
  searchCatalog: SearchCatalog
  searchTv: SearchTv
  visibilityScope: VisibilityScopeResolver
}) =>
  defineModule({
    exposes: {
      routes: searchRoutes({
        searchCatalog: deps.searchCatalog,
        searchTv: deps.searchTv,
        scopeFor: deps.visibilityScope,
      }),
    },
  })

export type SearchModule = ReturnType<typeof buildSearchModule>
