import { and, asc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'

import { DEFAULT_TV_SNAPSHOT_GRABS_PER_HOUR, tvSnapshotsEnabledOf } from '@projo/shared/api/tv'

import { type TvSnapshotRepository, tvSnapshotPathOf } from '../../core/tv/snapshot.ts'
import type { Db } from './database.ts'
import { fromIso, toIso } from './rows.ts'
import { tvChannels, tvFavorites, tvGroups, tvSources } from './schema/tv.ts'

const enabledPresent = and(eq(tvChannels.enabled, true), isNull(tvChannels.missingSince))

/** The snapshots' columns of channels and sources (§29.4). */
export const createSqliteTvSnapshotRepository = ({ db }: { db: Db }): TvSnapshotRepository => ({
  sources: () =>
    db
      .select({
        id: tvSources.id,
        maxConnections: tvSources.maxConnections,
        snapshots: tvSources.snapshots,
        grabsPerHour: tvSources.snapshotGrabsPerHour,
      })
      .from(tvSources)
      .orderBy(asc(tvSources.createdAt))
      .all()
      .map(({ id, maxConnections, snapshots, grabsPerHour }) => ({
        id,
        ...(maxConnections === null ? {} : { maxConnections }),
        snapshots: tvSnapshotsEnabledOf({
          snapshots: snapshots ?? undefined,
          maxConnections: maxConnections ?? undefined,
        }),
        grabsPerHour: grabsPerHour ?? DEFAULT_TV_SNAPSHOT_GRABS_PER_HOUR,
      })),

  candidatesOf: (sourceId) =>
    db
      .select({
        id: tvChannels.id,
        snapshotAt: tvChannels.snapshotAt,
        attemptAt: tvChannels.snapshotAttemptAt,
        failures: tvChannels.snapshotFailures,
        watchedAt: tvChannels.watchedAt,
      })
      .from(tvChannels)
      .innerJoin(tvGroups, eq(tvGroups.id, tvChannels.groupId))
      .where(and(eq(tvChannels.sourceId, sourceId), enabledPresent))
      .orderBy(asc(tvGroups.position), asc(tvChannels.position))
      .all()
      .map(({ id, snapshotAt, attemptAt, failures, watchedAt }) => ({
        id,
        ...(snapshotAt === null ? {} : { snapshotAt: fromIso(snapshotAt) }),
        ...(attemptAt === null ? {} : { attemptAt: fromIso(attemptAt) }),
        failures,
        ...(watchedAt === null ? {} : { watchedAt: fromIso(watchedAt) }),
      })),

  favoriteChannelIds: () =>
    new Set(
      db
        .selectDistinct({ channelId: tvFavorites.channelId })
        .from(tvFavorites)
        .all()
        .map(({ channelId }) => channelId),
    ),

  snapshotAtOf: (channelId) => {
    const row = db
      .select({ snapshotAt: tvChannels.snapshotAt })
      .from(tvChannels)
      .where(eq(tvChannels.id, channelId))
      .get()
    return row?.snapshotAt === undefined || row.snapshotAt === null
      ? undefined
      : fromIso(row.snapshotAt)
  },

  recordSnapshot: ({ id, at, grabbed }) =>
    db
      .update(tvChannels)
      .set({
        snapshotAt: toIso(at),
        ...(grabbed ? { snapshotAttemptAt: toIso(at), snapshotFailures: 0 } : {}),
      })
      .where(eq(tvChannels.id, id))
      .returning({ id: tvChannels.id })
      .all().length > 0,

  recordGrabFailure: ({ id, at }) => {
    db.update(tvChannels)
      .set({
        snapshotAttemptAt: toIso(at),
        snapshotFailures: sql`${tvChannels.snapshotFailures} + 1`,
      })
      .where(eq(tvChannels.id, id))
      .run()
  },

  recordWatched: ({ id, at }) => {
    db.update(tvChannels)
      .set({ watchedAt: toIso(at) })
      .where(eq(tvChannels.id, id))
      .run()
  },

  freshSnapshots: (since) =>
    new Map(
      db
        .select({ id: tvChannels.id, snapshotAt: tvChannels.snapshotAt })
        .from(tvChannels)
        .where(and(enabledPresent, gte(tvChannels.snapshotAt, toIso(since))))
        .all()
        .flatMap(({ id, snapshotAt }) =>
          snapshotAt === null ? [] : [[id, fromIso(snapshotAt)] as const],
        ),
    ),

  snapshotPathsOf: (sourceId) =>
    db
      .select({ id: tvChannels.id })
      .from(tvChannels)
      .where(and(eq(tvChannels.sourceId, sourceId), isNotNull(tvChannels.snapshotAt)))
      .all()
      .map(({ id }) => tvSnapshotPathOf(id)),
})
