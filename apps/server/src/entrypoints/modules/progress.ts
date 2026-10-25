import { catalogEntriesFactory } from '../../application/catalog/catalog-entries.ts'
import { hideFromContinueFactory } from '../../application/progress/hide-from-continue.ts'
import { progressViewsFactory } from '../../application/progress/progress-views.ts'
import { recordProgressFactory } from '../../application/progress/record-progress.ts'
import { setWatchedFactory } from '../../application/progress/set-watched.ts'
import { watchlistFactory } from '../../application/watchlist/watchlist.ts'
import { createSqliteCatalogRepository } from '../../infrastructure/sqlite/catalog-repository.ts'
import { createSqliteProgressRepository } from '../../infrastructure/sqlite/progress-repository.ts'
import { createSqliteWatchlistRepository } from '../../infrastructure/sqlite/watchlist-repository.ts'
import { progressRoutes } from '../http/routes/progress.ts'
import { watchlistRoutes } from '../http/routes/watchlist.ts'
import { allVisible, type ScopeDeps } from './catalog.ts'
import type { Platform } from './platform.ts'

/**
 * Wiring of progress (§13.1): position, watched / unwatched (bulk on seasons and series),
 * "Remove", and "My list". Heartbeats write progress too (playback).
 */
export const buildProgressModule = (
  { db, clock }: Platform,
  { visibilityScope = allVisible }: ScopeDeps = {},
) => {
  const catalogRepository = createSqliteCatalogRepository({ db })
  const progressRepository = createSqliteProgressRepository({ db })
  const watchlistRepository = createSqliteWatchlistRepository({ db })
  const progressViews = progressViewsFactory({ catalogRepository, progressRepository })
  return {
    routes: progressRoutes({
      recordProgress: recordProgressFactory({ catalogRepository, progressRepository, clock }),
      setWatched: setWatchedFactory({
        catalogRepository,
        progressRepository,
        progressViews,
        clock,
      }),
      hideFromContinue: hideFromContinueFactory({ catalogRepository, progressRepository, clock }),
      scopeFor: visibilityScope,
    }),
    watchlistRoutes: watchlistRoutes({
      watchlist: watchlistFactory({
        catalogRepository,
        watchlistRepository,
        catalogEntries: catalogEntriesFactory({
          catalogRepository,
          progressViews,
          watchlistRepository,
        }),
        clock,
      }),
      scopeFor: visibilityScope,
    }),
  }
}
