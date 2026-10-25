import { and, eq, inArray, sql } from 'drizzle-orm'

import type { WatchlistEntry, WatchlistRepository } from '../../core/watchlist/watchlist.ts'
import { toCatalogItem } from './catalog-repository.ts'
import { visible } from './catalog-sql.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { items } from './schema/items.ts'
import { watchlist } from './schema/playback.ts'

const toEntry = (row: typeof watchlist.$inferSelect): WatchlistEntry => ({
  profileId: row.profileId,
  itemId: row.itemId,
  addedAt: fromIso(row.addedAt),
})

export const createSqliteWatchlistRepository = ({ db }: { db: Db }): WatchlistRepository => {
  const find: WatchlistRepository['find'] = ({ profileId, itemId }) => {
    const row = db
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.profileId, profileId), eq(watchlist.itemId, itemId)))
      .get()
    return row && toEntry(row)
  }
  return {
    find,
    findMany: ({ profileId, itemIds }) => {
      const found = new Set<string>()
      for (let i = 0; i < itemIds.length; i += 500) {
        for (const row of db
          .select({ itemId: watchlist.itemId })
          .from(watchlist)
          .where(
            and(
              eq(watchlist.profileId, profileId),
              inArray(watchlist.itemId, itemIds.slice(i, i + 500)),
            ),
          )
          .all()) {
          found.add(row.itemId)
        }
      }
      return found
    },
    add: (entry) => {
      db.insert(watchlist)
        .values({ profileId: entry.profileId, itemId: entry.itemId, addedAt: toIso(entry.addedAt) })
        .onConflictDoNothing()
        .run()
      return find(entry) ?? entry
    },
    remove: ({ profileId, itemId }) => {
      db.delete(watchlist)
        .where(and(eq(watchlist.profileId, profileId), eq(watchlist.itemId, itemId)))
        .run()
    },
    listVisible: ({ profileId, scope, after, limit }) =>
      db
        .select({ item: items, addedAt: watchlist.addedAt })
        .from(watchlist)
        .innerJoin(items, eq(items.id, watchlist.itemId))
        .where(
          and(
            eq(watchlist.profileId, profileId),
            visible(scope),
            ...(after === undefined
              ? []
              : [
                  sql`(${watchlist.addedAt}, ${watchlist.itemId}) < (${after.addedAt}, ${after.itemId})`,
                ]),
          ),
        )
        .orderBy(sql`${watchlist.addedAt} DESC`, sql`${watchlist.itemId} DESC`)
        .limit(limit)
        .all()
        .map((row) => ({ item: toCatalogItem(row.item), addedAt: fromIso(row.addedAt) })),
  }
}
