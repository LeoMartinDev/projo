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
      const before = db
        .select({ imdbId: items.imdbId, tvdbId: items.tvdbId })
        .from(items)
        .where(eq(items.id, id))
        .get()
      db.update(items).set(set).where(eq(items.id, id)).run()
      // §12.2: the databases are asked with these ids (an episode with its series'). New ones
      // void the cached misses of the item and its episodes; a plain refresh keeps them.
      if (
        before !== undefined &&
        (('imdbId' in patch && set.imdbId !== before.imdbId) ||
          ('tvdbId' in patch && set.tvdbId !== before.tvdbId))
      ) {
        db.run(sql`
          DELETE FROM segment_lookups
          WHERE outcome IN ('none', 'error') AND provider NOT IN ('chapter', 'fingerprint')
            AND item_id IN (SELECT ${id} UNION SELECT episode.id FROM items episode
              CROSS JOIN items season ON season.id = episode.parent_id WHERE season.parent_id = ${id})`)
      }
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

    moveItemRows: local.moveItemRows,
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
