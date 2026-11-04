import type { CatalogItem, VisibilityScope } from '../catalog/catalog.ts'

export type WatchlistEntry = { profileId: string; itemId: string; addedAt: Date }

export type WatchlistPosition = { addedAt: string; itemId: string }

export type WatchlistRepository = {
  find: (input: { profileId: string; itemId: string }) => WatchlistEntry | undefined
  findMany: (input: { profileId: string; itemIds: readonly string[] }) => Set<string>
  add: (entry: WatchlistEntry) => WatchlistEntry
  remove: (input: { profileId: string; itemId: string }) => void
  listVisible: (input: {
    profileId: string
    scope: VisibilityScope
    after?: WatchlistPosition
    limit: number
  }) => { item: CatalogItem; addedAt: Date }[]
}
