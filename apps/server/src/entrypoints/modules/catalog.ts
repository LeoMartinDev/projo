import { catalogEntriesFactory } from '../../application/catalog/catalog-entries.ts'
import { getItemFactory } from '../../application/catalog/get-item.ts'
import { listCatalogFactory, listGenresFactory } from '../../application/catalog/list-catalog.ts'
import { listChildrenFactory } from '../../application/catalog/list-children.ts'
import { searchCatalogFactory } from '../../application/catalog/search-catalog.ts'
import { seriesPlayFactory } from '../../application/catalog/series-play.ts'
import { getHomeFactory } from '../../application/home/get-home.ts'
import { getHomeCategoriesFactory } from '../../application/home/get-home-categories.ts'
import { progressViewsFactory } from '../../application/progress/progress-views.ts'
import { everything, type VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import { createSqliteCatalogRepository } from '../../infrastructure/sqlite/catalog-repository.ts'
import { createSqliteHomeCategoryQueries } from '../../infrastructure/sqlite/home-category-queries.ts'
import { createSqliteProgressRepository } from '../../infrastructure/sqlite/progress-repository.ts'
import { createSqliteWatchlistRepository } from '../../infrastructure/sqlite/watchlist-repository.ts'
import { catalogRoutes } from '../http/routes/catalog.ts'
import { type HomePreviewPort, type HomeResumeFramePort, homeRoutes } from '../http/routes/home.ts'
import { searchRoutes } from '../http/routes/search.ts'
import type { Platform } from './platform.ts'

/**
 * What a profile may see beyond §6.3 visibility (§14: library access, maximum rating). Injected
 * by `main.ts` from the profiles module; without it, everything (single-profile setups, tests).
 */
export type ScopeDeps = { visibilityScope?: VisibilityScopeResolver }

export const allVisible: VisibilityScopeResolver = () => everything

/**
 * Wiring of the catalog read side (§13.3–§13.5): home and its category rows, movies, series,
 * genres, items, children, search. `imageAccess` is for the images route (§14: an image exists for a profile only through
 * a visible item or a person credited on one).
 */
export const buildCatalogModule = (
  { db }: Platform,
  {
    visibilityScope = allVisible,
    homePreviews,
    homeResumeFrames,
  }: ScopeDeps & { homePreviews?: HomePreviewPort; homeResumeFrames?: HomeResumeFramePort } = {},
) => {
  const catalogRepository = createSqliteCatalogRepository({ db })
  const progressRepository = createSqliteProgressRepository({ db })
  const watchlistRepository = createSqliteWatchlistRepository({ db })
  const progressViews = progressViewsFactory({ catalogRepository, progressRepository })
  const catalogEntries = catalogEntriesFactory({
    catalogRepository,
    progressViews,
    watchlistRepository,
  })
  const seriesPlay = seriesPlayFactory({ catalogRepository, progressRepository })
  return {
    routes: catalogRoutes({
      listCatalog: listCatalogFactory({ catalogRepository, catalogEntries }),
      listGenres: listGenresFactory({ catalogRepository }),
      getItem: getItemFactory({ catalogRepository, catalogEntries, seriesPlay }),
      listChildren: listChildrenFactory({ catalogRepository, catalogEntries }),
      scopeFor: visibilityScope,
    }),
    homeRoutes: homeRoutes({
      getHome: getHomeFactory({
        catalogRepository,
        progressRepository,
        progressQueries: progressRepository,
        watchlistRepository,
        catalogEntries,
        seriesPlay,
      }),
      getHomeCategories: getHomeCategoriesFactory({
        categoryQueries: createSqliteHomeCategoryQueries({ db }),
        catalogRepository,
        progressQueries: progressRepository,
        catalogEntries,
      }),
      scopeFor: visibilityScope,
      // §13.3 hero preview, from the media assets module.
      ...(homePreviews === undefined ? {} : { previews: homePreviews }),
      // §13.3 "Continue watching" frames, from the media assets module.
      ...(homeResumeFrames === undefined ? {} : { resumeFrames: homeResumeFrames }),
    }),
    searchRoutes: searchRoutes({
      searchCatalog: searchCatalogFactory({ catalogRepository, catalogEntries }),
      scopeFor: visibilityScope,
    }),
    imageAccess: {
      /** True when the profile may load this image (`GET /images/:id` answers 404 otherwise). */
      canView: ({ imageId, profileId }: { imageId: string; profileId: string }): boolean =>
        catalogRepository.isImageVisible({ imageId, scope: visibilityScope(profileId) }),
    },
  }
}
