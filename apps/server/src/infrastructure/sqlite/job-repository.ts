import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { isJobType, type Job, type JobError } from '../../core/jobs/job.ts'
import type { JobRepository } from '../../core/jobs/ports.ts'
import type { Db } from './database.ts'
import { fromIso, fromIsoNullable, parseJsonColumn, toIso } from './rows.ts'
import { jobs } from './schema/ops.ts'

type JobRow = typeof jobs.$inferSelect

/**
 * `code` read as any string: a row written by another version may carry a code this one does not
 * declare (the admin's "Jobs" shows it as is, `JobErrorDto`).
 */
const jobErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
})

export const toJob = (row: JobRow): Job => {
  if (!isJobType(row.type)) throw new Error(`unknown job type in database: ${row.type}`)
  const startedAt = fromIsoNullable(row.startedAt)
  const finishedAt = fromIsoNullable(row.finishedAt)
  const error =
    row.error === null
      ? undefined
      : (parseJsonColumn(jobErrorSchema, row.error, 'jobs.error') as JobError)
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    priority: row.priority,
    state: row.state,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: fromIso(row.runAfter),
    ...(row.dedupeKey === null ? {} : { dedupeKey: row.dedupeKey }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(finishedAt === undefined ? {} : { finishedAt }),
    ...(row.progress === null ? {} : { progress: row.progress }),
    ...(error === undefined ? {} : { error }),
  }
}

const serializeError = (error: JobError): JobError => ({
  code: error.code,
  message: error.message,
  ...(error.context === undefined ? {} : { context: error.context }),
})

const mustExist = (row: JobRow | undefined, id: string): JobRow => {
  if (row === undefined) throw new Error(`job not found: ${id}`)
  return row
}

export const createSqliteJobRepository = ({ db }: { db: Db }): JobRepository => ({
  enqueue: (job) =>
    db.transaction((tx) => {
      if (job.dedupeKey !== undefined) {
        const existing = tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.dedupeKey, job.dedupeKey), eq(jobs.state, 'queued')))
          .get()
        if (existing !== undefined) {
          const runAfter = toIso(job.runAfter)
          const updated = tx
            .update(jobs)
            .set({
              priority: Math.max(existing.priority, job.priority),
              runAfter: runAfter < existing.runAfter ? runAfter : existing.runAfter,
              ...(job.mergePayload === undefined
                ? {}
                : { payload: job.mergePayload(existing.payload) }),
            })
            .where(eq(jobs.id, existing.id))
            .returning()
            .get()
          return { job: toJob(mustExist(updated, existing.id)), deduplicated: true }
        }
      }
      const inserted = tx
        .insert(jobs)
        .values({
          id: job.id,
          type: job.type,
          payload: job.payload,
          dedupeKey: job.dedupeKey,
          priority: job.priority,
          state: 'queued',
          attempts: 0,
          maxAttempts: job.maxAttempts,
          runAfter: toIso(job.runAfter),
        })
        .returning()
        .get()
      return { job: toJob(inserted), deduplicated: false }
    }),

  claimNext: ({ types, now }) => {
    if (types.length === 0) return undefined
    return db.transaction((tx) => {
      const candidate = tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.state, 'queued'),
            inArray(jobs.type, [...types]),
            lte(jobs.runAfter, toIso(now)),
            or(
              isNull(jobs.dedupeKey),
              sql`NOT EXISTS (SELECT 1 FROM jobs AS running_jobs WHERE running_jobs.state = 'running' AND running_jobs.dedupe_key = "jobs"."dedupe_key")`,
            ),
          ),
        )
        .orderBy(desc(jobs.priority), asc(jobs.runAfter), asc(jobs.id))
        .limit(1)
        .get()
      if (candidate === undefined) return undefined
      const claimed = tx
        .update(jobs)
        .set({
          state: 'running',
          attempts: candidate.attempts + 1,
          startedAt: toIso(now),
          progress: null,
        })
        .where(eq(jobs.id, candidate.id))
        .returning()
        .get()
      return toJob(mustExist(claimed, candidate.id))
    })
  },

  complete: ({ id, finishedAt }) =>
    toJob(
      mustExist(
        db
          .update(jobs)
          .set({ state: 'done', finishedAt: toIso(finishedAt), progress: 100, error: null })
          .where(eq(jobs.id, id))
          .returning()
          .get(),
        id,
      ),
    ),

  fail: ({ id, error, finishedAt, retryAt }) =>
    toJob(
      mustExist(
        db
          .update(jobs)
          .set(
            retryAt === undefined
              ? { state: 'failed', finishedAt: toIso(finishedAt), error: serializeError(error) }
              : { state: 'queued', runAfter: toIso(retryAt), error: serializeError(error) },
          )
          .where(eq(jobs.id, id))
          .returning()
          .get(),
        id,
      ),
    ),

  cancel: ({ id, finishedAt }) => {
    const row = db
      .update(jobs)
      .set({ state: 'cancelled', finishedAt: toIso(finishedAt) })
      .where(and(eq(jobs.id, id), inArray(jobs.state, ['queued', 'running'])))
      .returning()
      .get()
    return row === undefined ? undefined : toJob(row)
  },

  updateProgress: ({ id, progress }) => {
    db.update(jobs)
      .set({ progress: Math.round(Math.min(100, Math.max(0, progress))) })
      .where(eq(jobs.id, id))
      .run()
  },

  requeueRunning: ({ finishedAt }) =>
    db.transaction((tx) => {
      const crashed: JobError = {
        code: 'job/handler_crashed',
        message: 'process stopped during the last attempt',
      }
      const failed = tx
        .update(jobs)
        .set({ state: 'failed', finishedAt: toIso(finishedAt), error: crashed })
        .where(and(eq(jobs.state, 'running'), sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
        .returning()
        .all()
        .map(toJob)
      const requeued = tx
        .update(jobs)
        .set({ state: 'queued' })
        .where(eq(jobs.state, 'running'))
        .returning({ id: jobs.id })
        .all().length
      return { requeued, failed }
    }),

  release: ({ id }) => {
    const row = db
      .update(jobs)
      .set({
        state: 'queued',
        attempts: sql`max(${jobs.attempts} - 1, 0)`,
        startedAt: null,
        progress: null,
      })
      .where(and(eq(jobs.id, id), eq(jobs.state, 'running')))
      .returning()
      .get()
    return row === undefined ? undefined : toJob(row)
  },

  // One range per state on `jobs_state_finished_at_idx`; `queued` and `running` rows are never
  // matched, whatever their `finished_at`.
  purgeFinished: ({ doneBefore, failedBefore }) =>
    db
      .delete(jobs)
      .where(
        or(
          and(eq(jobs.state, 'done'), lt(jobs.finishedAt, toIso(doneBefore))),
          and(
            inArray(jobs.state, ['failed', 'cancelled']),
            lt(jobs.finishedAt, toIso(failedBefore)),
          ),
        ),
      )
      .returning({ id: jobs.id })
      .all().length,

  findById: (id) => {
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get()
    return row === undefined ? undefined : toJob(row)
  },
})
