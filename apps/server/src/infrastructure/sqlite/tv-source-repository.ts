import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { tvSourceSettingsInputSchema } from '@projo/shared/api/tv'

import type { JobType } from '../../core/jobs/job.ts'
import {
  sourceIdOfRefreshKey,
  type TvRefreshActivity,
  type TvSource,
  type TvSourceRepository,
  type TvSourceSettings,
} from '../../core/tv/source.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn, stripNulls, toIso, toNullable } from './rows.ts'
import { jobs } from './schema/ops.ts'
import { tvSources } from './schema/tv.ts'

const failureSchema = z.object({ code: z.string(), message: z.string() })

const toSettings = (value: unknown): TvSourceSettings => {
  const settings = parseJsonColumn(tvSourceSettingsInputSchema, value, 'tv_sources.settings')
  if (settings.kind === 'freebox') return { kind: 'freebox', address: settings.address }
  const { kind, playlistUrl, guideUrl, userAgent } = settings
  return {
    kind,
    playlistUrl,
    ...(guideUrl === undefined ? {} : { guideUrl }),
    ...(userAgent === undefined ? {} : { userAgent }),
  }
}

const toSource = (row: typeof tvSources.$inferSelect): TvSource => {
  const {
    maxConnections,
    discoveredGuideUrl,
    lastAttemptAt,
    lastRefreshAt,
    lastError,
    guideAttemptAt,
    ...rest
  } = stripNulls(row)
  return {
    id: rest.id,
    name: rest.name,
    settings: toSettings(rest.settings),
    ...(maxConnections === undefined ? {} : { maxConnections }),
    ...(discoveredGuideUrl === undefined ? {} : { discoveredGuideUrl }),
    createdAt: fromIso(rest.createdAt),
    ...(lastAttemptAt === undefined ? {} : { lastAttemptAt: fromIso(lastAttemptAt) }),
    ...(lastRefreshAt === undefined ? {} : { lastRefreshAt: fromIso(lastRefreshAt) }),
    ...(lastError === undefined
      ? {}
      : { lastError: parseJsonColumn(failureSchema, lastError, 'tv_sources.last_error') }),
    failureCount: rest.failureCount,
    ...(guideAttemptAt === undefined ? {} : { guideAttemptAt: fromIso(guideAttemptAt) }),
  }
}

export const createSqliteTvSourceRepository = ({ db }: { db: Db }): TvSourceRepository => ({
  list: () =>
    db
      .select()
      .from(tvSources)
      .orderBy(asc(sql`lower(${tvSources.name})`), asc(tvSources.createdAt))
      .all()
      .map(toSource),
  findById: (id) => {
    const row = db.select().from(tvSources).where(eq(tvSources.id, id)).get()
    return row === undefined ? undefined : toSource(row)
  },
  save: (source) => {
    const own = {
      kind: source.settings.kind,
      name: source.name,
      settings: source.settings,
      maxConnections: toNullable(source.maxConnections),
    }
    db.insert(tvSources)
      .values({ id: source.id, createdAt: toIso(source.createdAt), ...own })
      .onConflictDoUpdate({ target: tvSources.id, set: own })
      .run()
  },
  delete: (id) => {
    db.delete(tvSources).where(eq(tvSources.id, id)).run()
  },
  recordSuccess: ({ id, at, discoveredGuideUrl }) => {
    db.update(tvSources)
      .set({
        lastAttemptAt: toIso(at),
        lastRefreshAt: toIso(at),
        lastError: null,
        failureCount: 0,
        discoveredGuideUrl: toNullable(discoveredGuideUrl),
      })
      .where(eq(tvSources.id, id))
      .run()
  },
  recordFailure: ({ id, at, error }) => {
    const row = db
      .update(tvSources)
      .set({
        lastAttemptAt: toIso(at),
        lastError: { code: error.code, message: error.message },
        failureCount: sql`${tvSources.failureCount} + 1`,
      })
      .where(eq(tvSources.id, id))
      .returning({ failureCount: tvSources.failureCount })
      .get()
    return row?.failureCount ?? 0
  },
  recordGuideAttempt: ({ id, at }) => {
    db.update(tvSources)
      .set({ guideAttemptAt: toIso(at) })
      .where(eq(tvSources.id, id))
      .run()
  },
})

const refreshType: JobType = 'refresh_tv_source'
/** Reads the job queue: a source is refreshing while its `refresh_tv_source` is queued or running. */
export const createSqliteTvRefreshActivity = ({ db }: { db: Db }): TvRefreshActivity => ({
  refreshingSourceIds: () =>
    new Set(
      db
        .select({ dedupeKey: jobs.dedupeKey })
        .from(jobs)
        .where(and(eq(jobs.type, refreshType), inArray(jobs.state, ['queued', 'running'])))
        .all()
        .flatMap(({ dedupeKey }) => {
          const sourceId = dedupeKey === null ? undefined : sourceIdOfRefreshKey(dedupeKey)
          return sourceId === undefined ? [] : [sourceId]
        }),
    ),
})
