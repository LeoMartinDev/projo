import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import type { Clock } from '../../core/clock.ts'
import type { LibraryLeftovers } from '../../core/library/library.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { sources } from './schema/libraries.ts'
import { jobs, notifications } from './schema/ops.ts'

const field = (column: typeof jobs.payload | typeof notifications.context, name: string) =>
  sql`json_extract(${column}, ${`$.${name}`})`

/**
 * `jobs` and `notifications` of a deleted library or removed roots (§7.1). A job is on them when
 * its payload names the library (`scan_library`, `refresh_metadata`) or one of their sources
 * (`probe_source`, `match_source`, `extract_subtitles`, `index_keyframes`, `trickplay`): the
 * fields `jobTargetOf` reads. Their items may live on in other libraries: their jobs stay. A
 * notification is about them when its context names the library, a root or a source.
 */
export const createSqliteLibraryLeftovers = ({
  db,
  clock,
}: {
  db: Db
  clock: Clock
}): LibraryLeftovers => ({
  clear: (scope) =>
    db.transaction((tx) => {
      const byLibrary = 'libraryId' in scope
      const rootIds = byLibrary ? [] : [...scope.rootIds]
      const sourceIds = tx
        .select({ id: sources.id })
        .from(sources)
        .where(
          byLibrary ? eq(sources.libraryId, scope.libraryId) : inArray(sources.rootId, rootIds),
        )
      const onJobs = or(
        byLibrary ? eq(field(jobs.payload, 'libraryId'), scope.libraryId) : undefined,
        inArray(field(jobs.payload, 'sourceId'), sourceIds),
      )
      tx.update(notifications)
        .set({ resolvedAt: toIso(clock.now()) })
        .where(
          and(
            isNull(notifications.resolvedAt),
            or(
              byLibrary
                ? eq(field(notifications.context, 'libraryId'), scope.libraryId)
                : inArray(field(notifications.context, 'rootId'), rootIds),
              inArray(field(notifications.context, 'sourceId'), sourceIds),
            ),
          ),
        )
        .run()
      tx.delete(jobs)
        .where(and(eq(jobs.state, 'queued'), onJobs))
        .run()
      const runningJobIds = tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.state, 'running'), onJobs))
        .all()
        .map((row) => row.id)
      return { runningJobIds }
    }),
})
