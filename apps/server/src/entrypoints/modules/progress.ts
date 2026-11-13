import { catalogEntriesFactory } from '../../application/catalog/catalog-entries.ts'
import { hideFromContinueFactory } from '../../application/progress/hide-from-continue.ts'
import { progressViewsFactory } from '../../application/progress/progress-views.ts'
import { recordProgressFactory } from '../../application/progress/record-progress.ts'
import { setWatchedFactory } from '../../application/progress/set-watched.ts'
import { watchlistFactory } from '../../application/watchlist/watchlist.ts'
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
        watchlist: watchlistFactory({
          visibleItems: catalog,
          watchlistRepository,
          catalogEntries: catalogEntriesFactory({
            catalogReadModel: catalog,
            progressViews,
            watchlistRepository,
          }),
          clock,
        }),
        scopeFor: visibilityScope,
      }),
    },
  })
}
