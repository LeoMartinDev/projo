import { and, eq, inArray, lt, sql } from 'drizzle-orm'

import type { MissingSourceRepository } from '../../core/source/source.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { itemOverrides, items, manualMatches } from './schema/items.ts'
import { sourceItems, sources } from './schema/libraries.ts'

/** SQLite's default limit of bound parameters is far above this; batches keep `IN (…)` short. */
const BATCH = 500

const chunks = <T>(values: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += BATCH)
    out.push(values.slice(index, index + BATCH))
  return out
}

/** "Manquants" (§7.5, §15): the `missing` sources and their purge. */
export const createSqliteMissingSourceRepository = ({
  db,
}: {
  db: Db
}): MissingSourceRepository => ({
  stateOf: (id) =>
    db.select({ state: sources.state }).from(sources).where(eq(sources.id, id)).get()?.state,

  listMissingIds: ({ libraryId, missingBefore }) =>
    db
      .select({ id: sources.id })
      .from(sources)
      .where(
        and(
          eq(sources.state, 'missing'),
          libraryId === undefined ? undefined : eq(sources.libraryId, libraryId),
          missingBefore === undefined ? undefined : lt(sources.missingSince, toIso(missingBefore)),
        ),
      )
      .all()
      .map((row) => row.id),

  purge: (sourceIds) =>
    db.transaction((tx) => {
      let purged = 0
      let deletedItems = 0
      for (const batch of chunks([...new Set(sourceIds)])) {
        const linked = [
          ...new Set(
            tx
              .select({ itemId: sourceItems.itemId })
              .from(sourceItems)
              .where(inArray(sourceItems.sourceId, batch))
              .all()
              .map((row) => row.itemId),
          ),
        ]
        // The identification of a purged file is a manual correction (§7.5): its items stay.
        const corrected = new Set(
          tx
            .select({ itemId: sourceItems.itemId })
            .from(sourceItems)
            .innerJoin(manualMatches, eq(manualMatches.sourceId, sourceItems.sourceId))
            .where(inArray(sourceItems.sourceId, batch))
            .all()
            .map((row) => row.itemId),
        )
        purged += tx
          .delete(sources)
          .where(and(inArray(sources.id, batch), eq(sources.state, 'missing')))
          .returning({ id: sources.id })
          .all().length

        // Items left without source and without child, unless corrected; then their parents.
        let level = linked.filter((id) => !corrected.has(id))
        while (level.length > 0) {
          const removable = tx
            .select({ id: items.id, parentId: items.parentId })
            .from(items)
            .where(
              and(
                inArray(items.id, level),
                sql`NOT EXISTS (SELECT 1 FROM ${sourceItems} WHERE ${sourceItems.itemId} = ${items.id})`,
                sql`NOT EXISTS (SELECT 1 FROM items AS child WHERE child.parent_id = ${items.id})`,
                sql`NOT EXISTS (SELECT 1 FROM ${itemOverrides} WHERE ${itemOverrides.itemId} = ${items.id})`,
              ),
            )
            .all()
          if (removable.length === 0) break
          tx.delete(items)
            .where(
              inArray(
                items.id,
                removable.map((row) => row.id),
              ),
            )
            .run()
          deletedItems += removable.length
          level = [
            ...new Set(removable.flatMap((row) => (row.parentId === null ? [] : [row.parentId]))),
          ]
        }
      }
      return { purged, deletedItems }
    }),
})
