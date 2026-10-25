import { andThen, appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository, VisibilityScope } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import { decodeCursor, encodeCursor } from '../../core/catalog/cursor.ts'
import type { WatchlistEntry, WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import type { CatalogEntries } from '../catalog/catalog-entries.ts'
import type { CatalogPage } from '../catalog/list-catalog.ts'

type Deps = {
  catalogRepository: CatalogRepository
  watchlistRepository: WatchlistRepository
  catalogEntries: CatalogEntries
  clock: Clock
}

export type WatchlistItemError = AppError<'item/not_found' | 'item/invalid_kind'>

/** Same cursor as Movies / Shows sorted by addition, on the date of addition to the list. */
const cursorSort = { sort: 'added', order: 'desc' } as const

/** "My list" (§13.4, §17.2): movies and series of the active profile. */
export const watchlistFactory = ({
  catalogRepository,
  watchlistRepository,
  catalogEntries,
  clock,
}: Deps) => {
  const listable = (itemId: string, scope: VisibilityScope): Result<string, WatchlistItemError> => {
    const item = catalogRepository.findVisible({ id: itemId, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    if (item.kind !== 'movie' && item.kind !== 'series') {
      return err(
        appError('item/invalid_kind', 'only movies and series go in the watchlist', {
          context: { itemId, kind: item.kind },
        }),
      )
    }
    return ok(item.id)
  }

  return {
    /** `GET /watchlist`: visible items, last added first. */
    list: async ({
      profileId,
      cursor,
      limit,
      scope,
    }: {
      profileId: string
      cursor?: string
      limit: number
      scope: VisibilityScope
    }): Promise<Result<CatalogPage, AppError<'catalog/invalid_cursor'>>> =>
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
      }),

    /** `GET /watchlist/:itemId`. */
    status: async ({
      profileId,
      itemId,
      scope,
    }: {
      profileId: string
      itemId: string
      scope: VisibilityScope
    }): Promise<Result<WatchlistEntry | undefined, WatchlistItemError>> =>
      andThen(listable(itemId, scope), (id) =>
        ok(watchlistRepository.find({ profileId, itemId: id })),
      ),

    /** `POST /watchlist/:itemId`: idempotent. */
    add: async ({
      profileId,
      itemId,
      scope,
    }: {
      profileId: string
      itemId: string
      scope: VisibilityScope
    }): Promise<Result<WatchlistEntry, WatchlistItemError>> =>
      andThen(listable(itemId, scope), (id) =>
        ok(watchlistRepository.add({ profileId, itemId: id, addedAt: clock.now() })),
      ),

    /** `DELETE /watchlist/:itemId`: idempotent; an item gone or hidden can still be removed. */
    remove: async ({ profileId, itemId }: { profileId: string; itemId: string }): Promise<void> => {
      watchlistRepository.remove({ profileId, itemId })
    },
  }
}

export type Watchlist = ReturnType<typeof watchlistFactory>
