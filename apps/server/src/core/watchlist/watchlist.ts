import type { CatalogItem, VisibilityScope } from '../catalog/catalog.ts'

/** §6.4 `watchlist` ("My list"): movies and series a profile keeps for later. */

export type WatchlistEntry = { profileId: string; itemId: string; addedAt: Date }

/** Keyset position in a list: date of addition, then item id (both descending). */
export type WatchlistPosition = { addedAt: string; itemId: string }

export type WatchlistRepository = {
  find: (input: { profileId: string; itemId: string }) => WatchlistEntry | undefined
  /** The ids among `itemIds` that are in the profile's list. */
  findMany: (input: { profileId: string; itemIds: readonly string[] }) => Set<string>
  /** Idempotent: an item already in the list keeps its date. */
  add: (entry: WatchlistEntry) => WatchlistEntry
  remove: (input: { profileId: string; itemId: string }) => void
  /** Visible items of the list, last added first. */
  listVisible: (input: {
    profileId: string
    scope: VisibilityScope
    after?: WatchlistPosition
    limit: number
  }) => { item: CatalogItem; addedAt: Date }[]
}
