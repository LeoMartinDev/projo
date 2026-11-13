import { getItemFactory } from '../../application/catalog/get-item.ts'
import { listCatalogFactory } from '../../application/catalog/list-catalog.ts'
import { listGenresFactory } from '../../application/catalog/list-genres.ts'
import { listChildrenFactory } from '../../application/catalog/list-children.ts'
import { searchCatalogFactory } from '../../application/catalog/search-catalog.ts'
import { catalogEntriesFactory } from '../../application/catalog/shared/catalog-entries.ts'
import { seriesPlayFactory } from '../../application/catalog/shared/series-play.ts'
import { getHomeFactory } from '../../application/home/get-home.ts'
import { getHomeCategoriesFactory } from '../../application/home/get-home-categories.ts'
import { getHomeCategoryPageFactory } from '../../application/home/get-home-category-page.ts'
import { progressViewsFactory } from '../../application/progress/shared/progress-views.ts'
import { everything, type VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import { createSqliteCatalog } from '../../infrastructure/sqlite/catalog.ts'
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
  const catalog = createSqliteCatalog({ db })
  const progressRepository = createSqliteProgressRepository({ db })
  const watchlistRepository = createSqliteWatchlistRepository({ db })
  const progressViews = progressViewsFactory({ visibleItems: catalog, progressRepository })
  const catalogEntries = catalogEntriesFactory({
    catalogReadModel: catalog,
    progressViews,
    watchlistRepository,
  })
  const seriesPlay = seriesPlayFactory({ catalogReadModel: catalog, progressRepository })
  const homeCategoryDeps = {
    categoryQueries: createSqliteHomeCategoryQueries({ db }),
    catalogReadModel: catalog,
    progressQueries: progressRepository,
    catalogEntries,
  }
  return defineModule({
    exposes: {
      routes: catalogRoutes({
        listCatalog: listCatalogFactory({ catalogReadModel: catalog, catalogEntries }),
        listGenres: listGenresFactory({ catalogReadModel: catalog }),
        getItem: getItemFactory({
          catalogReadModel: catalog,
          playableSources: catalog,
          catalogEntries,
          seriesPlay,
        }),
        listChildren: listChildrenFactory({ catalogReadModel: catalog, catalogEntries }),
        scopeFor: visibilityScope,
      }),
      homeRoutes: homeRoutes({
        getHome: getHomeFactory({
          catalogReadModel: catalog,
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
        searchCatalog: searchCatalogFactory({ catalogReadModel: catalog, catalogEntries }),
        scopeFor: visibilityScope,
      }),
      imageAccess: {
        canView: ({ imageId, profileId }: { imageId: string; profileId: string }): boolean =>
          catalog.isImageVisible({ imageId, scope: visibilityScope(profileId) }),
      },
    },
  })
}
