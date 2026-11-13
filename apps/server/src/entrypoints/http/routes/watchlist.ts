import { type Context, Hono } from 'hono'

import {
  type WatchlistPage,
  watchlistQuerySchema,
  type WatchlistStatus,
} from '@projo/shared/api/watchlist'

import type { AddToWatchlist } from '../../../application/watchlist/add-to-watchlist.ts'
import type { GetWatchlistStatus } from '../../../application/watchlist/get-watchlist-status.ts'
import type { ListWatchlist } from '../../../application/watchlist/list-watchlist.ts'
import type { RemoveFromWatchlist } from '../../../application/watchlist/remove-from-watchlist.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import type { WatchlistEntry } from '../../../core/watchlist/watchlist.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'
import { toItemSummaryDto } from './catalog.ts'

type Deps = {
  listWatchlist: ListWatchlist
  getWatchlistStatus: GetWatchlistStatus
  addToWatchlist: AddToWatchlist
  removeFromWatchlist: RemoveFromWatchlist
  scopeFor: VisibilityScopeResolver
}

const toStatus = (itemId: string, entry: WatchlistEntry | undefined): WatchlistStatus => ({
  itemId,
  inWatchlist: entry !== undefined,
  ...(entry === undefined ? {} : { addedAt: entry.addedAt.toISOString() }),
})

export const watchlistRoutes = ({
  listWatchlist,
  getWatchlistStatus,
  addToWatchlist,
  removeFromWatchlist,
  scopeFor,
}: Deps) => {
  const status = (action: 'status' | 'add') => async (c: Context<AppEnv, '/watchlist/:itemId'>) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const itemId = c.req.param('itemId')
    const input = { profileId: profileId.value, itemId, scope: scopeFor(profileId.value) }
    const result = action === 'add' ? await addToWatchlist(input) : await getWatchlistStatus(input)
    return result.ok
      ? c.json(toStatus(itemId, result.value) satisfies WatchlistStatus, 200)
      : respondError(c, result.error)
  }

  return new Hono<AppEnv>()
    .get('/watchlist', validate('query', watchlistQuerySchema), async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const { cursor, limit } = c.req.valid('query')
      const result = await listWatchlist({
        profileId: profileId.value,
        limit,
        scope: scopeFor(profileId.value),
        ...(cursor === undefined ? {} : { cursor }),
      })
      return result.ok
        ? c.json(
            {
              items: result.value.entries.map(toItemSummaryDto),
              ...(result.value.nextCursor === undefined
                ? {}
                : { nextCursor: result.value.nextCursor }),
            } satisfies WatchlistPage,
            200,
          )
        : respondError(c, result.error)
    })
    .get('/watchlist/:itemId', status('status'))
    .post('/watchlist/:itemId', status('add'))
    .delete('/watchlist/:itemId', async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const itemId = c.req.param('itemId')
      await removeFromWatchlist({ profileId: profileId.value, itemId })
      return c.json(toStatus(itemId, undefined) satisfies WatchlistStatus, 200)
    })
}

export type WatchlistRoutes = ReturnType<typeof watchlistRoutes>
