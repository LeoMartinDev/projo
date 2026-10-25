import { and, desc, eq, ne, or } from 'drizzle-orm'

import type { ManualMatch, ManualMatchRepository } from '../../core/metadata/ports.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls, toIso, toNullable } from './rows.ts'
import { manualMatches } from './schema/items.ts'

const toManualMatch = (row: typeof manualMatches.$inferSelect): ManualMatch => {
  const { createdAt, ...rest } = stripNulls(row)
  return { ...rest, createdAt: fromIso(createdAt) }
}

/** `manual_matches` (§7.8, §9.2 "avant tout"), by file rather than by `sources` row. */
export const createSqliteManualMatchRepository = ({ db }: { db: Db }): ManualMatchRepository => {
  const first = (condition: ReturnType<typeof and>) => {
    const row = db
      .select()
      .from(manualMatches)
      .where(condition)
      .orderBy(desc(manualMatches.createdAt))
      .get()
    return row === undefined ? undefined : toManualMatch(row)
  }

  return {
    findFor: ({ id, libraryId, relativePath, signature }) =>
      first(eq(manualMatches.sourceId, id)) ??
      first(
        and(eq(manualMatches.libraryId, libraryId), eq(manualMatches.relativePath, relativePath)),
      ) ??
      (signature === undefined ? undefined : first(eq(manualMatches.signature, signature))),

    save: (match) => {
      const values = {
        signature: toNullable(match.signature),
        sourceId: toNullable(match.sourceId),
        tmdbId: match.tmdbId,
        kind: match.kind,
        seasonNumber: toNullable(match.seasonNumber),
        episodeNumber: toNullable(match.episodeNumber),
        createdBy: match.createdBy,
        createdAt: toIso(match.createdAt),
      }
      db.transaction((tx) => {
        if (match.sourceId !== undefined) {
          // The source moved (recognized by the scan): its correction at the old path is stale.
          tx.delete(manualMatches)
            .where(
              and(
                eq(manualMatches.sourceId, match.sourceId),
                or(
                  ne(manualMatches.libraryId, match.libraryId),
                  ne(manualMatches.relativePath, match.relativePath),
                ),
              ),
            )
            .run()
        }
        tx.insert(manualMatches)
          .values({ libraryId: match.libraryId, relativePath: match.relativePath, ...values })
          .onConflictDoUpdate({
            target: [manualMatches.libraryId, manualMatches.relativePath],
            set: values,
          })
          .run()
      })
    },
  }
}
