import { type Context, Hono } from 'hono'

import {
  type WatchlistPage,
  watchlistQuerySchema,
  type WatchlistStatus,
} from '@projo/shared/api/watchlist'

import type { Watchlist } from '../../../application/watchlist/watchlist.ts'
import type { VisibilityScopeResolver } from '../../../core/catalog/catalog.ts'
import type { WatchlistEntry } from '../../../core/watchlist/watchlist.ts'
import type { AppEnv } from '../context.ts'
import { respondError } from '../errors.ts'
import { currentProfileId } from '../principal.ts'
import { validate } from '../validation.ts'
import { toItemSummaryDto } from './catalog.ts'

type Deps = { watchlist: Watchlist; scopeFor: VisibilityScopeResolver }

const toStatus = (itemId: string, entry: WatchlistEntry | undefined): WatchlistStatus => ({
  itemId,
  inWatchlist: entry !== undefined,
  ...(entry === undefined ? {} : { addedAt: entry.addedAt.toISOString() }),
})

/**
 * §17.2 "My list": `GET /watchlist` (page, last added first), `GET|POST|DELETE
 * /watchlist/:itemId`. Mounted at `/api/v1`.
 */
export const watchlistRoutes = ({ watchlist, scopeFor }: Deps) => {
  const status = (action: 'status' | 'add') => async (c: Context<AppEnv, '/watchlist/:itemId'>) => {
    const profileId = currentProfileId(c)
    if (!profileId.ok) return respondError(c, profileId.error)
    const itemId = c.req.param('itemId')
    const input = { profileId: profileId.value, itemId, scope: scopeFor(profileId.value) }
    const result = action === 'add' ? await watchlist.add(input) : await watchlist.status(input)
    return result.ok
      ? c.json(toStatus(itemId, result.value) satisfies WatchlistStatus, 200)
      : respondError(c, result.error)
  }

  return new Hono<AppEnv>()
    .get('/watchlist', validate('query', watchlistQuerySchema), async (c) => {
      const profileId = currentProfileId(c)
      if (!profileId.ok) return respondError(c, profileId.error)
      const { cursor, limit } = c.req.valid('query')
      const result = await watchlist.list({
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
      await watchlist.remove({ profileId: profileId.value, itemId })
      return c.json(toStatus(itemId, undefined) satisfies WatchlistStatus, 200)
    })
}

export type WatchlistRoutes = ReturnType<typeof watchlistRoutes>
