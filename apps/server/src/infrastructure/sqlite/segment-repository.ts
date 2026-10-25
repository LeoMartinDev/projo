import { and, eq } from 'drizzle-orm'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import {
  canReplace,
  noSegmentKey,
  type Segment,
  type SegmentLookupKey,
  type SegmentLookupRow,
  type SegmentRepository,
  type SegmentSubmissionRepository,
} from '../../core/segments/segment.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls, toIso, toNullable } from './rows.ts'
import { segmentLookups, segments, segmentSubmissions } from './schema/playback.ts'

const toSegment = (row: typeof segments.$inferSelect): Segment => {
  const { createdAt, confidence, ...rest } = stripNulls(row)
  return {
    ...rest,
    createdAt: fromIso(createdAt),
    ...(confidence === undefined ? {} : { confidence }),
  }
}

const toLookup = (row: typeof segmentLookups.$inferSelect): SegmentLookupRow => ({
  itemId: row.itemId,
  // Written only through `saveLookup`: always a `SegmentLookupKey`.
  provider: row.provider as SegmentLookupKey,
  checkedAt: fromIso(row.checkedAt),
  outcome: row.outcome,
})

/** §6.4 `segments` and `segment_lookups`; the §12.1 priority rule is applied on `save`. */
export const createSqliteSegmentRepository = ({
  db,
  ids,
  clock,
}: {
  db: Db
  ids: IdGenerator
  clock: Clock
}): SegmentRepository => {
  const find: SegmentRepository['find'] = ({ itemId, type }) => {
    const row = db
      .select()
      .from(segments)
      .where(and(eq(segments.itemId, itemId), eq(segments.type, type)))
      .get()
    return row && toSegment(row)
  }

  return {
    listByItem: (itemId) =>
      db
        .select()
        .from(segments)
        .where(eq(segments.itemId, itemId))
        .orderBy(segments.startMs)
        .all()
        .map(toSegment),
    find,
    save: ({ itemId, origin, candidate }) =>
      db.transaction((tx) => {
        const existing = tx
          .select()
          .from(segments)
          .where(and(eq(segments.itemId, itemId), eq(segments.type, candidate.type)))
          .get()
        if (!canReplace(existing?.origin, origin)) return undefined
        // §12.1: a negative marker stops every source but the admin's own markers, even one
        // set while a job was running (the job read the markers when it started).
        if (origin !== 'manual') {
          const marker = tx
            .select({ provider: segmentLookups.provider })
            .from(segmentLookups)
            .where(
              and(
                eq(segmentLookups.itemId, itemId),
                eq(segmentLookups.provider, noSegmentKey(candidate.type)),
              ),
            )
            .get()
          if (marker !== undefined) return undefined
        }
        const row = {
          id: existing?.id ?? ids.next(),
          itemId,
          type: candidate.type,
          startMs: Math.round(candidate.startMs),
          endMs: Math.round(candidate.endMs),
          origin,
          confidence: toNullable(candidate.confidence),
          createdAt: toIso(clock.now()),
        }
        tx.insert(segments)
          .values(row)
          .onConflictDoUpdate({
            target: [segments.itemId, segments.type],
            set: {
              startMs: row.startMs,
              endMs: row.endMs,
              origin: row.origin,
              confidence: row.confidence,
              createdAt: row.createdAt,
            },
          })
          .run()
        return toSegment(row)
      }),
    remove: ({ itemId, type }) =>
      db
        .delete(segments)
        .where(and(eq(segments.itemId, itemId), eq(segments.type, type)))
        .returning({ id: segments.id })
        .all().length > 0,
    listLookups: (itemId) =>
      db.select().from(segmentLookups).where(eq(segmentLookups.itemId, itemId)).all().map(toLookup),
    saveLookup: ({ itemId, provider, checkedAt, outcome }) => {
      db.insert(segmentLookups)
        .values({ itemId, provider, checkedAt: toIso(checkedAt), outcome })
        .onConflictDoUpdate({
          target: [segmentLookups.itemId, segmentLookups.provider],
          set: { checkedAt: toIso(checkedAt), outcome },
        })
        .run()
    },
    removeLookup: ({ itemId, provider }) => {
      db.delete(segmentLookups)
        .where(and(eq(segmentLookups.itemId, itemId), eq(segmentLookups.provider, provider)))
        .run()
    },
  }
}

/** §12.5 `segment_submissions`: the log of manual markers sent to TheIntroDB / SkipDB. */
export const createSqliteSegmentSubmissionRepository = ({
  db,
  ids,
}: {
  db: Db
  ids: IdGenerator
}): SegmentSubmissionRepository => ({
  record: ({ itemId, type, provider, startMs, endMs, outcome, error, at }) => {
    db.insert(segmentSubmissions)
      .values({
        id: ids.next(),
        itemId,
        type,
        provider,
        startMs,
        endMs,
        outcome,
        error: toNullable(error),
        submittedAt: toIso(at),
      })
      .run()
  },
  wasSubmitted: ({ itemId, type, provider, startMs, endMs }) =>
    db
      .select({ id: segmentSubmissions.id })
      .from(segmentSubmissions)
      .where(
        and(
          eq(segmentSubmissions.itemId, itemId),
          eq(segmentSubmissions.type, type),
          eq(segmentSubmissions.provider, provider),
          eq(segmentSubmissions.startMs, startMs),
          eq(segmentSubmissions.endMs, endMs),
          eq(segmentSubmissions.outcome, 'submitted'),
        ),
      )
      .get() !== undefined,
})
