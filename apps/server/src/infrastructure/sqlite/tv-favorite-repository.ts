import { and, asc, eq, sql } from 'drizzle-orm'

import type { TvFavoriteRepository } from '../../core/tv/viewer.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { tvFavorites } from './schema/tv.ts'

/** A profile's favourite channels (§29.6), kept in the order they were added. */
export const createSqliteTvFavoriteRepository = ({ db }: { db: Db }): TvFavoriteRepository => ({
  listOf: (profileId) =>
    db
      .select({ channelId: tvFavorites.channelId })
      .from(tvFavorites)
      .where(eq(tvFavorites.profileId, profileId))
      .orderBy(asc(tvFavorites.position), asc(tvFavorites.createdAt))
      .all()
      .map(({ channelId }) => channelId),
  add: ({ profileId, channelId, at }) => {
    db.transaction((tx) => {
      const last = tx
        .select({ position: sql<number | null>`max(${tvFavorites.position})` })
        .from(tvFavorites)
        .where(eq(tvFavorites.profileId, profileId))
        .get()
      tx.insert(tvFavorites)
        .values({
          profileId,
          channelId,
          position: (last?.position ?? -1) + 1,
          createdAt: toIso(at),
        })
        .onConflictDoNothing()
        .run()
    })
  },
  remove: ({ profileId, channelId }) => {
    db.delete(tvFavorites)
      .where(and(eq(tvFavorites.profileId, profileId), eq(tvFavorites.channelId, channelId)))
      .run()
  },
})
