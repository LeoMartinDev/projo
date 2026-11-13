import { andThen, type AppError, ok, type Result } from '@projo/shared'

import type { VisibilityScope } from '../../core/catalog/catalog.ts'
import { decodeCursor, encodeCursor } from '../../core/catalog/cursor.ts'
import type { WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import type { CatalogPage } from '../catalog/list-catalog.ts'
import type { CatalogEntries } from '../catalog/shared/catalog-entries.ts'

const cursorSort = { sort: 'added', order: 'desc' } as const

export type ListWatchlistError = AppError<'catalog/invalid_cursor'>

export const listWatchlistFactory =
  ({
    watchlistRepository,
    catalogEntries,
  }: {
    watchlistRepository: WatchlistRepository
    catalogEntries: CatalogEntries
  }) =>
  async ({
    profileId,
    cursor,
    limit,
    scope,
  }: {
    profileId: string
    cursor?: string
    limit: number
    scope: VisibilityScope
  }): Promise<Result<CatalogPage, ListWatchlistError>> =>
    andThen(cursor === undefined ? ok(undefined) : decodeCursor(cursor, cursorSort), (after) => {
      const rows = watchlistRepository.listVisible({
        profileId,
        scope,
        limit: limit + 1,
        ...(after === undefined
          ? {}
          : { after: { addedAt: String(after.keys[0] ?? ''), itemId: after.id } }),
      })
      const page = rows.slice(0, limit)
      const last = page[page.length - 1]
      return ok({
        entries: catalogEntries({ profileId, items: page.map((row) => row.item), scope }),
        ...(rows.length > limit && last !== undefined
          ? {
              nextCursor: encodeCursor({
                ...cursorSort,
                position: { keys: [last.addedAt.toISOString()], id: last.item.id },
              }),
            }
          : {}),
      })
    })

export type ListWatchlist = ReturnType<typeof listWatchlistFactory>
