import { and, eq, inArray, sql } from 'drizzle-orm'

import type { MediaAssetCatalog } from '../../core/playback/media-assets.ts'
import { ratingOfItemId, readySourceIn } from './catalog-sql.ts'
import type { Db } from './database.ts'
import { items } from './schema/items.ts'
import { libraries, sources, sourceSubtitles } from './schema/libraries.ts'

/** SQLite `IN (…)` lists stay under the bound-parameter limit. */
const chunkSize = 500

const existing = (ids: readonly string[], lookup: (chunk: string[]) => { id: string }[]) => {
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += chunkSize) {
    for (const row of lookup(ids.slice(i, i + chunkSize))) found.add(row.id)
  }
  return found
}

export const createSqliteMediaAssetCatalog = ({ db }: { db: Db }): MediaAssetCatalog => ({
  isSourceVisible: ({ sourceId, scope }) => {
    const [row] = db.all<{ found: number }>(sql`SELECT 1 AS found
      FROM source_items si
      CROSS JOIN sources ON sources.id = si.source_id
      CROSS JOIN libraries ON libraries.id = sources.library_id
      WHERE si.source_id = ${sourceId}
        AND ${readySourceIn(scope, ratingOfItemId(sql`si.item_id`))}
      LIMIT 1`)
    return row !== undefined
  },

  libraryFlags: (sourceId) =>
    db
      .select({
        preExtractSubtitles: libraries.preExtractSubtitles,
        trickplayEnabled: libraries.trickplayEnabled,
      })
      .from(sources)
      .innerJoin(libraries, eq(libraries.id, sources.libraryId))
      .where(eq(sources.id, sourceId))
      .get(),

  listTrickplayCandidates: () =>
    db
      .select({
        id: sources.id,
        sizeBytes: sources.sizeBytes,
        mtimeMs: sources.mtime,
        inProgress: sql<number>`EXISTS (SELECT 1 FROM source_items si
          CROSS JOIN playback_progress pp ON pp.item_id = si.item_id
          WHERE si.source_id = ${sources.id} AND pp.position_ms > 0 AND pp.watched = 0
            AND pp.hidden_from_continue = 0)`,
      })
      .from(sources)
      .innerJoin(libraries, eq(libraries.id, sources.libraryId))
      .where(and(eq(sources.state, 'ready'), eq(libraries.trickplayEnabled, true)))
      .all()
      .map(({ id, sizeBytes, mtimeMs, inProgress }) => ({
        id,
        fingerprint: { sizeBytes, mtimeMs },
        inProgress: inProgress === 1,
      })),

  existingSourceIds: (ids) =>
    existing(ids, (chunk) =>
      db.select({ id: sources.id }).from(sources).where(inArray(sources.id, chunk)).all(),
    ),

  existingTrackIds: (ids) =>
    existing(ids, (chunk) =>
      db
        .select({ id: sourceSubtitles.id })
        .from(sourceSubtitles)
        .where(inArray(sourceSubtitles.id, chunk))
        .all(),
    ),

  existingItemIds: (ids) =>
    existing(ids, (chunk) =>
      db.select({ id: items.id }).from(items).where(inArray(items.id, chunk)).all(),
    ),

  previewTargetOf: (itemId) => {
    const [row] = db.all<{ id: string; kind: string }>(sql`SELECT
        CASE i.kind
          WHEN 'season' THEN i.parent_id
          WHEN 'episode' THEN (SELECT s.parent_id FROM items s WHERE s.id = i.parent_id)
          ELSE i.id END AS id,
        CASE i.kind WHEN 'movie' THEN 'movie' ELSE 'series' END AS kind
      FROM items i WHERE i.id = ${itemId}`)
    if (row === undefined || typeof row.id !== 'string') return undefined
    return { id: row.id, kind: row.kind === 'movie' ? 'movie' : 'series' }
  },
})
