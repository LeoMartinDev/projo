import { catalogEntriesFactory } from '../../application/catalog/shared/catalog-entries.ts'
import { hideFromContinueFactory } from '../../application/progress/hide-from-continue.ts'
import { recordProgressFactory } from '../../application/progress/record-progress.ts'
import { setWatchedFactory } from '../../application/progress/set-watched.ts'
import { progressViewsFactory } from '../../application/progress/shared/progress-views.ts'
import { addToWatchlistFactory } from '../../application/watchlist/add-to-watchlist.ts'
import { getWatchlistStatusFactory } from '../../application/watchlist/get-watchlist-status.ts'
import { listWatchlistFactory } from '../../application/watchlist/list-watchlist.ts'
import { removeFromWatchlistFactory } from '../../application/watchlist/remove-from-watchlist.ts'
import { createSqliteCatalog } from '../../infrastructure/sqlite/catalog.ts'
import { createSqliteProgressRepository } from '../../infrastructure/sqlite/progress-repository.ts'
import { createSqliteWatchlistRepository } from '../../infrastructure/sqlite/watchlist-repository.ts'
import { progressRoutes } from '../http/routes/progress.ts'
import { watchlistRoutes } from '../http/routes/watchlist.ts'
import type { ScopeDeps } from './catalog.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildProgressModule = ({ db, clock }: Platform, { visibilityScope }: ScopeDeps) => {
  const catalog = createSqliteCatalog({ db })
  const progressRepository = createSqliteProgressRepository({ db })
  const watchlistRepository = createSqliteWatchlistRepository({ db })
  const progressViews = progressViewsFactory({ visibleItems: catalog, progressRepository })
  return defineModule({
    exposes: {
      routes: progressRoutes({
        recordProgress: recordProgressFactory({
          visibleItems: catalog,
          playableSources: catalog,
          progressRepository,
          clock,
        }),
        setWatched: setWatchedFactory({
          visibleItems: catalog,
          progressRepository,
          progressViews,
          clock,
        }),
        hideFromContinue: hideFromContinueFactory({
          visibleItems: catalog,
          progressRepository,
          clock,
        }),
        scopeFor: visibilityScope,
      }),
      watchlistRoutes: watchlistRoutes({
        listWatchlist: listWatchlistFactory({
          watchlistRepository,
          catalogEntries: catalogEntriesFactory({
            catalogReadModel: catalog,
            progressViews,
            watchlistRepository,
          }),
        }),
        getWatchlistStatus: getWatchlistStatusFactory({
          visibleItems: catalog,
          watchlistRepository,
        }),
        addToWatchlist: addToWatchlistFactory({
          visibleItems: catalog,
          watchlistRepository,
          clock,
        }),
        removeFromWatchlist: removeFromWatchlistFactory({ watchlistRepository }),
        scopeFor: visibilityScope,
      }),
    },
  })
}
