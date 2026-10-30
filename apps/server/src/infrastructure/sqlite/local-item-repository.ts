import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { LinkedItem, LocalItemRepository } from '../../core/scanner/item-linking.ts'
import type { Db } from './database.ts'
import { toIso, toNullable } from './rows.ts'
import { items } from './schema/items.ts'
import { sourceItems, sources } from './schema/libraries.ts'

/** Writes of the M1 local items (see `core/scanner/item-linking.ts`). */
export const createSqliteLocalItemRepository = ({ db }: { db: Db }): LocalItemRepository => {
  const parentsOf = (ids: string[]): string[] =>
    ids.length === 0
      ? []
      : db
          .select({ parentId: items.parentId })
          .from(items)
          .where(inArray(items.id, ids))
          .all()
          .flatMap((row) => (row.parentId === null ? [] : [row.parentId]))

  return {
    transaction: (run) => db.transaction(() => run()),

    linksOf: (sourceId) =>
      db
        .select({
          itemId: items.id,
          kind: items.kind,
          tmdbId: items.tmdbId,
          episodeNumber: items.episodeNumber,
        })
        .from(sourceItems)
        .innerJoin(items, eq(items.id, sourceItems.itemId))
        .where(eq(sourceItems.sourceId, sourceId))
        .all()
        .map((row): LinkedItem => ({
          itemId: row.itemId,
          kind: row.kind,
          ...(row.tmdbId === null ? {} : { tmdbId: row.tmdbId }),
          ...(row.episodeNumber === null ? {} : { episodeNumber: row.episodeNumber }),
        })),

    parentOf: (id) => parentsOf([id])[0],

    moveItemRows: ({ from, into }) => {
      if (from === into) return
      // Progress (§13.1): rows without conflict move as they are; on conflict, the most recent
      // position wins, "watched" is kept from either side, play counts add up.
      db.run(sql`UPDATE OR IGNORE playback_progress SET item_id = ${into} WHERE item_id = ${from}`)
      db.run(sql`
        UPDATE playback_progress AS t SET
          position_ms = CASE WHEN f.last_played_at > t.last_played_at THEN f.position_ms ELSE t.position_ms END,
          duration_ms = CASE WHEN f.last_played_at > t.last_played_at THEN f.duration_ms ELSE t.duration_ms END,
          hidden_from_continue = CASE WHEN f.last_played_at > t.last_played_at THEN f.hidden_from_continue ELSE t.hidden_from_continue END,
          watched = max(t.watched, f.watched),
          watched_at = CASE
            WHEN t.watched_at IS NULL THEN f.watched_at
            WHEN f.watched_at IS NULL THEN t.watched_at
            ELSE max(t.watched_at, f.watched_at) END,
          play_count = t.play_count + f.play_count,
          last_played_at = max(t.last_played_at, f.last_played_at)
        FROM playback_progress AS f
        WHERE f.item_id = ${from} AND t.item_id = ${into} AND t.profile_id = f.profile_id`)
      db.run(sql`DELETE FROM playback_progress WHERE item_id = ${from}`)
      // Ma liste: one row per (profile, item), the earliest addition kept.
      db.run(sql`UPDATE OR IGNORE watchlist SET item_id = ${into} WHERE item_id = ${from}`)
      db.run(sql`
        UPDATE watchlist AS t SET added_at = min(t.added_at, f.added_at)
        FROM watchlist AS f
        WHERE f.item_id = ${from} AND t.item_id = ${into} AND t.profile_id = f.profile_id`)
      db.run(sql`DELETE FROM watchlist WHERE item_id = ${from}`)
      // Track preferences (§11): the most recent choice wins.
      db.run(sql`UPDATE OR IGNORE track_preferences SET item_id = ${into} WHERE item_id = ${from}`)
      db.run(sql`
        UPDATE track_preferences AS t SET
          audio_language = f.audio_language,
          subtitle_language = f.subtitle_language,
          subtitles_enabled = f.subtitles_enabled,
          updated_at = f.updated_at
        FROM track_preferences AS f
        WHERE f.item_id = ${from} AND t.item_id = ${into} AND t.profile_id = f.profile_id
          AND f.updated_at > t.updated_at`)
      db.run(sql`DELETE FROM track_preferences WHERE item_id = ${from}`)
      // Segments (§12): what belongs to the file or the admin (manual, chapters, fingerprint)
      // follows, per type when the target has none of that type; a manual marker first replaces
      // the target's non-manual segment of its type (§12.1). What the community databases
      // said about the other identity (segments, cached answers) is dropped: a rematch would
      // otherwise carry them over. Negative markers follow and win over the target's non-manual
      // segment of their type.
      db.run(sql`
        DELETE FROM segments
        WHERE item_id = ${into} AND origin <> 'manual'
          AND type IN (SELECT type FROM segments WHERE item_id = ${from} AND origin = 'manual')`)
      db.run(sql`
        UPDATE segments SET item_id = ${into}
        WHERE item_id = ${from}
          AND origin IN ('manual', 'chapter', 'fingerprint')
          AND type NOT IN (SELECT type FROM segments WHERE item_id = ${into})`)
      db.run(sql`DELETE FROM segments WHERE item_id = ${from}`)
      db.run(sql`
        UPDATE OR IGNORE segment_lookups SET item_id = ${into}
        WHERE item_id = ${from} AND provider LIKE 'no_segment:%'`)
      db.run(sql`DELETE FROM segment_lookups WHERE item_id = ${from}`)
      db.run(sql`
        DELETE FROM segments
        WHERE item_id = ${into} AND origin <> 'manual'
          AND 'no_segment:' || type IN (
            SELECT provider FROM segment_lookups WHERE item_id = ${into})`)
      // The submissions log (§12.5) follows: a marker is not submitted twice.
      db.run(sql`UPDATE segment_submissions SET item_id = ${into} WHERE item_id = ${from}`)
      // Edits (§9.3) made on the local item survive when the target has none for that field.
      db.run(sql`UPDATE OR IGNORE item_overrides SET item_id = ${into} WHERE item_id = ${from}`)
      // Sessions in progress follow the file.
      db.run(sql`UPDATE playback_sessions SET item_id = ${into} WHERE item_id = ${from}`)
      db.run(sql`
        UPDATE items SET added_at = (
          SELECT min(added_at) FROM items WHERE id IN (${from}, ${into}) AND added_at IS NOT NULL)
        WHERE id = ${into}
          AND EXISTS (SELECT 1 FROM items WHERE id = ${from} AND added_at IS NOT NULL)`)
    },

    findLocalRoots: ({ kind, sortTitle }) =>
      db
        .select({ id: items.id, year: items.year })
        .from(items)
        .where(
          and(
            eq(items.kind, kind),
            eq(items.sortTitle, sortTitle),
            isNull(items.tmdbId),
            isNull(items.parentId),
          ),
        )
        .orderBy(items.createdAt, items.id)
        .all()
        .map((row) => ({ id: row.id, ...(row.year === null ? {} : { year: row.year }) })),

    findChild: ({ parentId, kind, number }) =>
      db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.parentId, parentId),
            eq(items.kind, kind),
            kind === 'season' ? eq(items.seasonNumber, number) : eq(items.episodeNumber, number),
          ),
        )
        .orderBy(items.createdAt, items.id)
        .get()?.id,

    create: (item) => {
      const now = toIso(item.createdAt)
      db.insert(items)
        .values({
          id: item.id,
          kind: item.kind,
          parentId: toNullable(item.parentId),
          // NOT NULL column: '' = no title of its own (§6.3).
          title: item.title ?? '',
          sortTitle: item.sortTitle,
          year: toNullable(item.year),
          seasonNumber: toNullable(item.seasonNumber),
          episodeNumber: toNullable(item.episodeNumber),
          createdAt: now,
          updatedAt: now,
        })
        .run()
    },

    setYear: ({ id, year }) => {
      db.update(items)
        .set({ year })
        .where(and(eq(items.id, id), isNull(items.year)))
        .run()
    },

    replaceLinks: ({ sourceId, itemIds }) => {
      db.delete(sourceItems).where(eq(sourceItems.sourceId, sourceId)).run()
      if (itemIds.length > 0) {
        db.insert(sourceItems)
          .values(itemIds.map((itemId) => ({ sourceId, itemId })))
          .onConflictDoNothing()
          .run()
      }
    },

    markAdded: ({ itemIds, at }) => {
      let level = [...new Set(itemIds)]
      const iso = toIso(at)
      while (level.length > 0) {
        db.update(items)
          .set({ addedAt: iso })
          .where(and(inArray(items.id, level), isNull(items.addedAt)))
          .run()
        level = [...new Set(parentsOf(level))]
      }
    },

    pruneOrphans: (itemIds, beforeDelete) => {
      let level = [...new Set(itemIds)]
      while (level.length > 0) {
        const parents = parentsOf(level)
        const removable = db
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              inArray(items.id, level),
              isNull(items.tmdbId),
              sql`not exists (select 1 from ${sourceItems} where ${sourceItems.itemId} = ${items.id})`,
              sql`not exists (select 1 from items as child where child.parent_id = ${items.id})`,
            ),
          )
          .all()
          .map((row) => row.id)
        if (removable.length === 0) return
        beforeDelete(removable)
        db.delete(items).where(inArray(items.id, removable)).run()
        level = [...new Set(parents)]
      }
    },

    itemIdsOfLibrary: (libraryId) =>
      db
        .selectDistinct({ itemId: sourceItems.itemId })
        .from(sourceItems)
        .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
        .where(eq(sources.libraryId, libraryId))
        .all()
        .map((row) => row.itemId),
  }
}
