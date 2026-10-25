import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { errorCodes } from '@projo/shared'

import { byVersionDescending } from '../../core/updates/semver.ts'
import type { AppVersion, UpdateRepository, UpdateRun } from '../../core/updates/update.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn, stripNulls, toIso, toNullable } from './rows.ts'
import { appVersions, updateRuns } from './schema/ops.ts'

const runErrorSchema = z.object({ code: z.enum(errorCodes), message: z.string() })

const toAppVersion = (row: typeof appVersions.$inferSelect): AppVersion => ({
  version: row.version,
  state: row.state,
  installedAt: fromIso(row.installedAt),
  runtimeMin: row.runtimeMin,
})

const toRun = (row: typeof updateRuns.$inferSelect): UpdateRun => {
  const { finishedAt, error, requestedAt, ...rest } = stripNulls(row)
  return {
    ...rest,
    requestedAt: fromIso(requestedAt),
    ...(finishedAt === undefined ? {} : { finishedAt: fromIso(finishedAt) }),
    ...(error === undefined
      ? {}
      : { error: parseJsonColumn(runErrorSchema, error, 'update_runs.error') }),
  }
}

/** `app_versions` and `update_runs` (§6.5, §15 "update log"). */
export const createSqliteUpdateRepository = ({ db }: { db: Db }): UpdateRepository => ({
  versions: () =>
    db
      .select()
      .from(appVersions)
      .all()
      .map(toAppVersion)
      .sort((a, b) => byVersionDescending(a.version, b.version)),

  upsertVersion: (version) => {
    const values = {
      version: version.version,
      state: version.state,
      installedAt: toIso(version.installedAt),
      runtimeMin: version.runtimeMin,
    }
    db.insert(appVersions)
      .values(values)
      .onConflictDoUpdate({ target: appVersions.version, set: values })
      .run()
  },

  setVersionState: ({ version, state }) => {
    db.update(appVersions).set({ state }).where(eq(appVersions.version, version)).run()
  },

  startRun: (run) => {
    const row = db
      .insert(updateRuns)
      .values({
        id: run.id,
        kind: run.kind,
        fromVersion: run.fromVersion,
        toVersion: run.toVersion,
        requestedAt: toIso(run.requestedAt),
        outcome: 'pending',
      })
      .returning()
      .get()
    return toRun(row)
  },

  finishRun: ({ id, outcome, finishedAt, error }) => {
    const row = db
      .update(updateRuns)
      .set({
        outcome,
        finishedAt: toIso(finishedAt),
        error: toNullable(
          error === undefined ? undefined : { code: error.code, message: error.message },
        ),
      })
      .where(eq(updateRuns.id, id))
      .returning()
      .get()
    return row === undefined ? undefined : toRun(row)
  },

  pendingRun: () => {
    const row = db
      .select()
      .from(updateRuns)
      .where(eq(updateRuns.outcome, 'pending'))
      .orderBy(desc(updateRuns.requestedAt))
      .get()
    return row === undefined ? undefined : toRun(row)
  },

  recentRuns: (limit) =>
    db
      .select()
      .from(updateRuns)
      .orderBy(desc(updateRuns.requestedAt), desc(updateRuns.id))
      .limit(limit)
      .all()
      .map(toRun),
})
