import type { WatchlistRepository } from '../../core/watchlist/watchlist.ts'

export const removeFromWatchlistFactory =
  ({ watchlistRepository }: { watchlistRepository: WatchlistRepository }) =>
  async ({ profileId, itemId }: { profileId: string; itemId: string }): Promise<void> => {
    watchlistRepository.remove({ profileId, itemId })
  }

export type RemoveFromWatchlist = ReturnType<typeof removeFromWatchlistFactory>
