import { eq, lt } from 'drizzle-orm'

import type { TmdbResponsePurge, TmdbResponseStore } from '../../core/metadata/ports.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { tmdbResponses } from './schema/metadata.ts'

/** `tmdb_responses`: TMDB detail responses cached in the database (§9.2). */
export const createSqliteTmdbResponseStore = ({
  db,
}: {
  db: Db
}): TmdbResponseStore & TmdbResponsePurge => ({
  get: (key) => {
    const row = db.select().from(tmdbResponses).where(eq(tmdbResponses.key, key)).get()
    return row === undefined
      ? undefined
      : { payload: row.payload, fetchedAt: fromIso(row.fetchedAt) }
  },
  put: ({ key, payload, fetchedAt }) => {
    db.insert(tmdbResponses)
      .values({ key, payload, fetchedAt: toIso(fetchedAt) })
      .onConflictDoUpdate({
        target: tmdbResponses.key,
        set: { payload, fetchedAt: toIso(fetchedAt) },
      })
      .run()
  },
  purgeFetchedBefore: (before) =>
    db
      .delete(tmdbResponses)
      .where(lt(tmdbResponses.fetchedAt, toIso(before)))
      .returning({ key: tmdbResponses.key })
      .all().length,
})
