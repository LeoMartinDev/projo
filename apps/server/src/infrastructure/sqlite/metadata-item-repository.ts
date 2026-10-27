import { and, eq, inArray, isNull, sql } from 'drizzle-orm'

import type { LockableField } from '../../core/metadata/enrichment.ts'
import type { LinkedItemInfo } from '../../core/metadata/linking.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import { sortTitleOf } from '../../core/scanner/item-linking.ts'
import type { Db } from './database.ts'
import { decidingLibraryOf } from './item-library.ts'
import { createSqliteLocalItemRepository } from './local-item-repository.ts'
import { stripNulls, toIso, toNullable } from './rows.ts'
import { itemOverrides, itemPeople, items, people } from './schema/items.ts'
import { sourceItems, sources } from './schema/libraries.ts'

type ItemRow = Pick<
  typeof items.$inferSelect,
  'id' | 'kind' | 'tmdbId' | 'parentId' | 'seasonNumber' | 'episodeNumber'
>

const infoColumns = {
  id: items.id,
  kind: items.kind,
  tmdbId: items.tmdbId,
  parentId: items.parentId,
  seasonNumber: items.seasonNumber,
  episodeNumber: items.episodeNumber,
}

const toInfo = (row: ItemRow): LinkedItemInfo => stripNulls(row)

const LOCKABLE: readonly LockableField[] = [
  'title',
  'year',
  'overview',
  'genres',
  'poster_image_id',
  'backdrop_image_id',
]

/** Item writes of the TMDB identification (§9.2) and the local → TMDB fusion. */
export const createSqliteMetadataItemRepository = ({ db }: { db: Db }): MetadataItemRepository => {
  const local = createSqliteLocalItemRepository({ db })

  const descendantsCondition = (itemId: string) =>
    sql`(${items.id} = ${itemId} OR ${items.parentId} = ${itemId} OR ${items.parentId} IN (SELECT id FROM items WHERE parent_id = ${itemId}))`

  return {
    transaction: local.transaction,

    findItem: (id) => {
      const row = db.select(infoColumns).from(items).where(eq(items.id, id)).get()
      return row === undefined ? undefined : toInfo(row)
    },

    linkedItems: (sourceId) =>
      db
        .select(infoColumns)
        .from(sourceItems)
        .innerJoin(items, eq(items.id, sourceItems.itemId))
        .where(eq(sourceItems.sourceId, sourceId))
        .orderBy(items.episodeNumber, items.id)
        .all()
        .map(toInfo),

    findByTmdb: ({ kind, tmdbId }) =>
      db
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.kind, kind), eq(items.tmdbId, tmdbId), isNull(items.parentId)))
        .orderBy(items.createdAt, items.id)
        .get()?.id,

    findChild: local.findChild,

    create: (item) => {
      const now = toIso(item.createdAt)
      db.insert(items)
        .values({
          id: item.id,
          kind: item.kind,
          parentId: toNullable(item.parentId),
          tmdbId: toNullable(item.tmdbId),
          // NOT NULL column: '' = no title of its own (§6.3).
          title: item.title ?? '',
          sortTitle: item.sortTitle,
          seasonNumber: toNullable(item.seasonNumber),
          episodeNumber: toNullable(item.episodeNumber),
          createdAt: now,
          updatedAt: now,
        })
        .run()
    },

    setTmdbId: ({ id, tmdbId }) => {
      db.update(items).set({ tmdbId }).where(eq(items.id, id)).run()
    },

    lockedFields: (itemId) =>
      new Set(
        db
          .select({ field: itemOverrides.field })
          .from(itemOverrides)
          .where(eq(itemOverrides.itemId, itemId))
          .all()
          .map((row) => row.field)
          .filter((field): field is LockableField => LOCKABLE.includes(field)),
      ),

    writeMetadata: ({ id, patch, language, refreshedAt }) => {
      const set: Partial<typeof items.$inferInsert> = {
        metadataLanguage: language,
        metadataRefreshedAt: toIso(refreshedAt),
        updatedAt: toIso(refreshedAt),
      }
      if ('title' in patch) {
        // `undefined`: a season or an episode without a name of its own (§6.3).
        set.title = patch.title ?? ''
        set.sortTitle = sortTitleOf(patch.title ?? '')
      }
      if ('genres' in patch) set.genres = patch.genres ?? []
      const nullable = [
        'originalTitle',
        'year',
        'overview',
        'releaseDate',
        'runtimeMinutes',
        'originalLanguage',
        'voteAverage',
        'contentRating',
        'contentRatingCountry',
        'seriesStatus',
        'airDate',
        'lastAirDate',
        'episodeCountTmdb',
        'imdbId',
        'tvdbId',
      ] as const
      for (const key of nullable) {
        if (key in patch) Object.assign(set, { [key]: toNullable(patch[key]) })
      }
      db.update(items).set(set).where(eq(items.id, id)).run()
    },

    replacePeople: ({ itemId, people: credits, newId }) => {
      db.delete(itemPeople).where(eq(itemPeople.itemId, itemId)).run()
      const seen = new Set<string>()
      for (const credit of credits) {
        const existing = db
          .select({ id: people.id, name: people.name })
          .from(people)
          .where(eq(people.tmdbId, credit.tmdbId))
          .get()
        const personId = existing?.id ?? newId()
        if (existing === undefined) {
          db.insert(people).values({ id: personId, tmdbId: credit.tmdbId, name: credit.name }).run()
        } else if (existing.name !== credit.name) {
          db.update(people).set({ name: credit.name }).where(eq(people.id, personId)).run()
        }
        const key = `${personId}:${credit.role}`
        if (seen.has(key)) continue
        seen.add(key)
        db.insert(itemPeople)
          .values({
            itemId,
            personId,
            role: credit.role,
            character: toNullable(credit.character),
            order: credit.order,
          })
          .run()
      }
    },

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

    replaceLinks: local.replaceLinks,
    markAdded: local.markAdded,
    pruneOrphans: local.pruneOrphans,

    sourcesUnder: (itemId) => {
      const rows = db
        .select({
          sourceId: sourceItems.sourceId,
          seasonNumber: items.seasonNumber,
          episodeNumber: items.episodeNumber,
        })
        .from(sourceItems)
        .innerJoin(items, eq(items.id, sourceItems.itemId))
        .where(descendantsCondition(itemId))
        .orderBy(sourceItems.sourceId, items.seasonNumber, items.episodeNumber)
        .all()
      const bySource = new Map<
        string,
        { sourceId: string; seasonNumber?: number; episodeNumber?: number }
      >()
      for (const row of rows) {
        if (!bySource.has(row.sourceId)) bySource.set(row.sourceId, stripNulls(row))
      }
      return [...bySource.values()]
    },

    sourcesAwaitingMatch: ({ libraryId, reviewReasons }) =>
      db
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            eq(sources.state, 'ready'),
            libraryId === undefined ? undefined : eq(sources.libraryId, libraryId),
            reviewReasons.length === 0
              ? eq(sources.matchState, 'unmatched')
              : sql`(${sources.matchState} = 'unmatched' OR (${sources.matchState} = 'needs_review' AND ${inArray(sources.reviewReason, [...reviewReasons])}))`,
          ),
        )
        .orderBy(sources.id)
        .all()
        .map((row) => row.id),

    imageContext: (itemId) => {
      const row = db
        .select({
          id: items.id,
          kind: items.kind,
          tmdbId: items.tmdbId,
          parentId: items.parentId,
          seasonNumber: items.seasonNumber,
          episodeNumber: items.episodeNumber,
        })
        .from(items)
        .where(eq(items.id, itemId))
        .get()
      if (row === undefined) return undefined
      const item = stripNulls(row)
      const parentOf = (id: string | undefined) =>
        id === undefined
          ? undefined
          : db
              .select({
                id: items.id,
                parentId: items.parentId,
                tmdbId: items.tmdbId,
                kind: items.kind,
              })
              .from(items)
              .where(eq(items.id, id))
              .get()
      const parent = parentOf(item.parentId)
      const series =
        item.kind === 'season'
          ? parent
          : item.kind === 'episode'
            ? parentOf(parent?.parentId ?? undefined)
            : undefined
      // §9.1: the language of the library deciding the whole tree, never an arbitrary one.
      const language = decidingLibraryOf(db, itemId)?.language
      return {
        id: item.id,
        kind: item.kind,
        ...(item.tmdbId === undefined ? {} : { tmdbId: item.tmdbId }),
        ...(item.seasonNumber === undefined ? {} : { seasonNumber: item.seasonNumber }),
        ...(item.episodeNumber === undefined ? {} : { episodeNumber: item.episodeNumber }),
        ...(series?.tmdbId === undefined || series.tmdbId === null
          ? {}
          : { seriesTmdbId: series.tmdbId }),
        ...(language === undefined ? {} : { libraryLanguage: language }),
      }
    },

    peopleOf: (itemId) =>
      db
        .selectDistinct({
          personId: people.id,
          tmdbId: people.tmdbId,
          profileImageId: people.profileImageId,
        })
        .from(itemPeople)
        .innerJoin(people, eq(people.id, itemPeople.personId))
        .where(eq(itemPeople.itemId, itemId))
        .all()
        .map(stripNulls),
  }
}
