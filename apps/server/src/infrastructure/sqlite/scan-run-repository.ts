import { and, desc, eq, isNull, lt } from 'drizzle-orm'

import { scanStatsSchema } from '@projo/shared/api/libraries'

import { emptyScanStats, type ScanRun, type ScanRunRepository } from '../../core/scanner/ports.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn, stripNulls, toIso, toNullable } from './rows.ts'
import { scanRuns } from './schema/libraries.ts'

const toScanRun = (row: typeof scanRuns.$inferSelect): ScanRun => {
  const r = stripNulls(row)
  return {
    id: r.id,
    libraryId: r.libraryId,
    kind: r.kind,
    startedAt: fromIso(r.startedAt),
    stats: parseJsonColumn(scanStatsSchema, r.stats, 'scan_runs.stats'),
    ...(r.finishedAt === undefined ? {} : { finishedAt: fromIso(r.finishedAt) }),
    ...(r.error === undefined ? {} : { error: r.error }),
  }
}

const mustExist = <T>(value: T | undefined, id: string): T => {
  if (value === undefined) throw new Error(`scan run not found: ${id}`)
  return value
}

export const createSqliteScanRunRepository = ({ db }: { db: Db }): ScanRunRepository => ({
  start: ({ id, libraryId, kind, startedAt }) =>
    toScanRun(
      mustExist(
        db
          .insert(scanRuns)
          .values({
            id,
            libraryId,
            kind,
            startedAt: toIso(startedAt),
            stats: emptyScanStats(),
          })
          .returning()
          .get(),
        id,
      ),
    ),
  finish: ({ id, finishedAt, stats, error }) =>
    toScanRun(
      mustExist(
        db
          .update(scanRuns)
          .set({ finishedAt: toIso(finishedAt), stats, error: toNullable(error) })
          .where(eq(scanRuns.id, id))
          .returning()
          .get(),
        id,
      ),
    ),
  closeUnfinished: ({ finishedAt, error }) =>
    db
      .update(scanRuns)
      .set({ finishedAt: toIso(finishedAt), error })
      .where(isNull(scanRuns.finishedAt))
      .returning({ id: scanRuns.id })
      .all().length,
  latest: (libraryId) => {
    const row = db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.libraryId, libraryId))
      .orderBy(desc(scanRuns.startedAt), desc(scanRuns.id))
      .limit(1)
      .get()
    return row === undefined ? undefined : toScanRun(row)
  },
  page: ({ libraryId, cursor, limit }) => {
    const rows = db
      .select()
      .from(scanRuns)
      .where(
        and(
          eq(scanRuns.libraryId, libraryId),
          cursor === undefined ? undefined : lt(scanRuns.id, cursor),
        ),
      )
      .orderBy(desc(scanRuns.id))
      .limit(limit + 1)
      .all()
    const items = rows.slice(0, limit).map(toScanRun)
    const last = items.at(-1)
    return {
      items,
      ...(rows.length > limit && last !== undefined ? { nextCursor: last.id } : {}),
    }
  },
  purgeFinishedBefore: (before) =>
    db.$client
      .query(
        // The latest run of a library stays: it is the library's "last scan" (§15).
        `DELETE FROM scan_runs WHERE finished_at < ?1 AND id NOT IN (
           SELECT (SELECT r.id FROM scan_runs r WHERE r.library_id = l.id
                   ORDER BY r.started_at DESC, r.id DESC LIMIT 1)
           FROM libraries l)`,
      )
      .run(toIso(before)).changes,
})
