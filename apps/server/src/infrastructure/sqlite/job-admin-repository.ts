import { and, count, desc, eq, gte, inArray, lt } from 'drizzle-orm'

import { isJobType } from '../../core/jobs/job.ts'
import type { JobAdminRepository } from '../../core/jobs/ports.ts'
import type { Db } from './database.ts'
import { toJob } from './job-repository.ts'
import { toIso } from './rows.ts'
import { jobs } from './schema/ops.ts'

/** The admin's view of `jobs` (§15 "Jobs"): list, retry, the dashboard's failure count. */
export const createSqliteJobAdminRepository = ({ db }: { db: Db }): JobAdminRepository => ({
  list: ({ state, type, cursor, limit }) => {
    const rows = db
      .select()
      .from(jobs)
      .where(
        and(
          state === undefined ? undefined : eq(jobs.state, state),
          type === undefined ? undefined : eq(jobs.type, type),
          cursor === undefined ? undefined : lt(jobs.id, cursor),
        ),
      )
      .orderBy(desc(jobs.id))
      .limit(limit + 1)
      .all()
    const pageRows = rows.slice(0, limit)
    const last = pageRows.at(-1)
    return {
      // A type another version enqueued (and this one does not run) is left out.
      items: pageRows.filter((row) => isJobType(row.type)).map(toJob),
      ...(rows.length > limit && last !== undefined ? { nextCursor: last.id } : {}),
    }
  },

  retry: ({ id, now }) => {
    const row = db
      .update(jobs)
      .set({
        state: 'queued',
        attempts: 0,
        runAfter: toIso(now),
        startedAt: null,
        finishedAt: null,
        progress: null,
        error: null,
      })
      .where(and(eq(jobs.id, id), inArray(jobs.state, ['failed', 'cancelled'])))
      .returning()
      .get()
    return row === undefined || !isJobType(row.type) ? undefined : toJob(row)
  },

  countFailedSince: (since) =>
    db
      .select({ total: count() })
      .from(jobs)
      .where(and(eq(jobs.state, 'failed'), gte(jobs.finishedAt, toIso(since))))
      .get()?.total ?? 0,
})
