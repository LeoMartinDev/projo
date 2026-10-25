import { asc, eq, isNull, sql } from 'drizzle-orm'

import type { CatalogCounts, StatsQueries } from '../../core/stats/stats.ts'
import type { Db } from './database.ts'
import { fromIso } from './rows.ts'
import { libraries, scanRuns } from './schema/libraries.ts'
import { playbackSessions } from './schema/playback.ts'

/**
 * A ready source of the item `alias` (§6.3), the admin seeing every library. Starts from the
 * item's links (`CROSS JOIN`, see `catalog-sql.ts`): one index lookup per item.
 */
const ready = (alias: string) =>
  sql.raw(
    `EXISTS (SELECT 1 FROM source_items si CROSS JOIN sources s ON s.id = si.source_id WHERE si.item_id = ${alias}.id AND s.state = 'ready')`,
  )

/**
 * §15 "Dashboard". Counts on 20 000 items: movies and episodes are one pass over their kind
 * (`items_kind…` index) with an indexed lookup each; series are the parents of the parents of the
 * visible episodes (`DISTINCT`, no correlated subquery per series); sources by state are one pass
 * over the `state` index.
 */
export const createSqliteStatsQueries = ({ db }: { db: Db }): StatsQueries => ({
  counts: (): CatalogCounts => {
    const [row] = db.all<{
      movies: number
      episodes: number
      series: number
      pending: number
      needsReview: number
      missing: number
    }>(sql`SELECT
      (SELECT count(*) FROM items m WHERE m.kind = 'movie' AND ${ready('m')}) AS movies,
      (SELECT count(*) FROM items e WHERE e.kind = 'episode' AND ${ready('e')}) AS episodes,
      (SELECT count(DISTINCT sn.parent_id) FROM items e CROSS JOIN items sn ON sn.id = e.parent_id
        WHERE e.kind = 'episode' AND ${ready('e')}) AS series,
      (SELECT count(*) FROM sources WHERE state = 'pending') AS pending,
      (SELECT count(*) FROM sources WHERE match_state = 'needs_review') AS needsReview,
      (SELECT count(*) FROM sources WHERE state = 'missing') AS missing`)
    if (row === undefined) throw new Error('stats query returned no row')
    return {
      movies: row.movies,
      series: row.series,
      episodes: row.episodes,
      pendingSources: row.pending,
      needsReview: row.needsReview,
      missingSources: row.missing,
    }
  },

  runningScans: () =>
    db
      .select({
        libraryId: scanRuns.libraryId,
        libraryName: libraries.name,
        scanRunId: scanRuns.id,
        kind: scanRuns.kind,
        startedAt: scanRuns.startedAt,
      })
      .from(scanRuns)
      .innerJoin(libraries, eq(libraries.id, scanRuns.libraryId))
      .where(isNull(scanRuns.finishedAt))
      .orderBy(asc(scanRuns.startedAt))
      .all()
      .map((row) => ({ ...row, startedAt: fromIso(row.startedAt) })),

  activePlaybackSessions: () =>
    db
      .select({ total: sql<number>`count(*)` })
      .from(playbackSessions)
      .where(isNull(playbackSessions.endedAt))
      .get()?.total ?? 0,
})
