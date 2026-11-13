import { andThen, ok, type Result } from '@projo/shared'

import type { VisibilityScope, VisibleItems } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { WatchlistEntry, WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import { listableItem, type WatchlistItemError } from './shared/listable-item.ts'

export const addToWatchlistFactory =
  ({
    visibleItems,
    watchlistRepository,
    clock,
  }: {
    visibleItems: Pick<VisibleItems, 'findVisible'>
    watchlistRepository: WatchlistRepository
    clock: Clock
  }) =>
  async ({
    profileId,
    itemId,
    scope,
  }: {
    profileId: string
    itemId: string
    scope: VisibilityScope
  }): Promise<Result<WatchlistEntry, WatchlistItemError>> =>
    andThen(listableItem(visibleItems, itemId, scope), (id) =>
      ok(watchlistRepository.add({ profileId, itemId: id, addedAt: clock.now() })),
    )

export type AddToWatchlist = ReturnType<typeof addToWatchlistFactory>
