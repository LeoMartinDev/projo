import { andThen, ok, type Result } from '@projo/shared'

import type { VisibilityScope, VisibleItems } from '../../core/catalog/catalog.ts'
import type { WatchlistEntry, WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import { listableItem, type WatchlistItemError } from './shared/listable-item.ts'

export const getWatchlistStatusFactory =
  ({
    visibleItems,
    watchlistRepository,
  }: {
    visibleItems: Pick<VisibleItems, 'findVisible'>
    watchlistRepository: WatchlistRepository
  }) =>
  async ({
    profileId,
    itemId,
    scope,
  }: {
    profileId: string
    itemId: string
    scope: VisibilityScope
  }): Promise<Result<WatchlistEntry | undefined, WatchlistItemError>> =>
    andThen(listableItem(visibleItems, itemId, scope), (id) =>
      ok(watchlistRepository.find({ profileId, itemId: id })),
    )

export type GetWatchlistStatus = ReturnType<typeof getWatchlistStatusFactory>
