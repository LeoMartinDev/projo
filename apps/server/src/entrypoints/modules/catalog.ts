import { catalogEntriesFactory } from '../../application/catalog/catalog-entries.ts'
import { getItemFactory } from '../../application/catalog/get-item.ts'
import { listCatalogFactory, listGenresFactory } from '../../application/catalog/list-catalog.ts'
import { listChildrenFactory } from '../../application/catalog/list-children.ts'
import { searchCatalogFactory } from '../../application/catalog/search-catalog.ts'
import { seriesPlayFactory } from '../../application/catalog/series-play.ts'
import { getHomeFactory } from '../../application/home/get-home.ts'
import { getHomeCategoriesFactory } from '../../application/home/get-home-categories.ts'
import { getHomeCategoryPageFactory } from '../../application/home/get-home-category-page.ts'
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
import { defineModule } from './types.ts'

export type ScopeDeps = { visibilityScope: VisibilityScopeResolver }

export const allVisible: VisibilityScopeResolver = () => everything

export const buildCatalogModule = (
  { db }: Platform,
  {
    visibilityScope,
    homePreviews,
    homeResumeFrames,
  }: ScopeDeps & { homePreviews?: HomePreviewPort; homeResumeFrames?: HomeResumeFramePort },
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
  const homeCategoryDeps = {
    categoryQueries: createSqliteHomeCategoryQueries({ db }),
    catalogRepository,
    progressQueries: progressRepository,
    catalogEntries,
  }
  return defineModule({
    exposes: {
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
        getHomeCategories: getHomeCategoriesFactory(homeCategoryDeps),
        getHomeCategoryPage: getHomeCategoryPageFactory(homeCategoryDeps),
        scopeFor: visibilityScope,
        ...(homePreviews === undefined ? {} : { previews: homePreviews }),
        ...(homeResumeFrames === undefined ? {} : { resumeFrames: homeResumeFrames }),
      }),
      searchRoutes: searchRoutes({
        searchCatalog: searchCatalogFactory({ catalogRepository, catalogEntries }),
        scopeFor: visibilityScope,
      }),
      imageAccess: {
        canView: ({ imageId, profileId }: { imageId: string; profileId: string }): boolean =>
          catalogRepository.isImageVisible({ imageId, scope: visibilityScope(profileId) }),
      },
    },
  })
}
