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
        .select({ itemId: items.id, kind: items.kind, tmdbId: items.tmdbId })
        .from(sourceItems)
        .innerJoin(items, eq(items.id, sourceItems.itemId))
        .where(eq(sourceItems.sourceId, sourceId))
        .all()
        .map((row): LinkedItem => ({
          itemId: row.itemId,
          kind: row.kind,
          ...(row.tmdbId === null ? {} : { tmdbId: row.tmdbId }),
        })),

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
