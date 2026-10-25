import { sql } from 'drizzle-orm'

import type { ItemKind } from '../../core/catalog/catalog.ts'
import { ownTitle } from '../../core/catalog/generic-titles.ts'
import type { SegmentCatalog, SegmentItemFacts } from '../../core/segments/catalog.ts'
import { lookupRetryAfterMs, segmentTypes } from '../../core/segments/segment.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'

type FactsRow = {
  id: string
  kind: ItemKind
  title: string
  episode_number: number | null
  season_number: number | null
  season_id: string | null
  tmdb_id: number | null
  imdb_id: string | null
  tvdb_id: number | null
  detect_segments: number
  shares_file: number
}

const optional = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: V }

/** §12.2 reads of the segment chain: an item and the ids of its movie or series. */
export const createSqliteSegmentCatalog = ({ db }: { db: Db }): SegmentCatalog => ({
  findItem: (itemId) => {
    // An episode is asked with its series' ids (§9.2 `/external_ids`), its season row holds the
    // season number when the episode row does not.
    const [row] = db.all<FactsRow>(sql`SELECT i.id, i.kind, i.title, i.episode_number,
        coalesce(i.season_number, season.season_number) AS season_number,
        CASE i.kind WHEN 'episode' THEN season.id END AS season_id,
        CASE i.kind WHEN 'episode' THEN series.tmdb_id ELSE i.tmdb_id END AS tmdb_id,
        CASE i.kind WHEN 'episode' THEN series.imdb_id ELSE i.imdb_id END AS imdb_id,
        CASE i.kind WHEN 'episode' THEN series.tvdb_id ELSE i.tvdb_id END AS tvdb_id,
        EXISTS (SELECT 1 FROM source_items si
          CROSS JOIN sources s ON s.id = si.source_id
          CROSS JOIN libraries l ON l.id = s.library_id
          WHERE si.item_id = i.id AND s.state = 'ready' AND l.detect_segments = 1
        ) AS detect_segments,
        EXISTS (SELECT 1 FROM source_items si
          CROSS JOIN sources s ON s.id = si.source_id
          CROSS JOIN source_items other ON other.source_id = si.source_id
          WHERE si.item_id = i.id AND s.state = 'ready' AND other.item_id <> i.id
        ) AS shares_file
      FROM items i
      LEFT JOIN items season ON season.id = i.parent_id AND i.kind = 'episode'
      LEFT JOIN items series ON series.id = season.parent_id
      WHERE i.id = ${itemId}`)
    if (row === undefined) return undefined
    const facts: SegmentItemFacts = {
      itemId: row.id,
      kind: row.kind,
      ...(row.kind === 'episode'
        ? optional(
            'episodeTitle',
            ownTitle({
              kind: 'episode',
              title: row.title,
              episodeNumber: row.episode_number ?? undefined,
            }) ?? null,
          )
        : {}),
      ...optional('seasonId', row.season_id),
      ...(row.kind === 'episode' ? optional('seasonNumber', row.season_number) : {}),
      ...optional('episodeNumber', row.episode_number),
      ...optional('tmdbId', row.tmdb_id),
      ...optional('imdbId', row.imdb_id),
      ...optional('tvdbId', row.tvdb_id),
      detectSegments: row.detect_segments === 1,
      sharesFile: row.shares_file === 1,
    }
    return facts
  },

  listSeasonEpisodeIds: (seasonId) =>
    db
      .all<{ id: string }>(
        sql`SELECT id FROM items
        WHERE parent_id = ${seasonId} AND +kind = 'episode'
        ORDER BY episode_number, sort_title`,
      )
      .map((row) => row.id),

  listUnidentifiedItemIds: (sourceId) =>
    db
      .all<{ id: string }>(
        sql`SELECT i.id FROM source_items si
        CROSS JOIN sources s ON s.id = si.source_id
        CROSS JOIN libraries l ON l.id = s.library_id
        CROSS JOIN items i ON i.id = si.item_id
        WHERE si.source_id = ${sourceId} AND s.state = 'ready'
          AND s.match_state IN ('unmatched', 'needs_review') AND l.detect_segments = 1
          AND +i.kind IN ('movie', 'episode')
          AND NOT EXISTS (SELECT 1 FROM segment_lookups sl WHERE sl.item_id = i.id)
        ORDER BY i.id`,
      )
      .map((row) => row.id),

  listItemsToResolve: ({ providers, now, limit }) => {
    const cutoff = (outcome: 'none' | 'error') =>
      toIso(new Date(now.getTime() - (lookupRetryAfterMs[outcome] ?? 0)))
    const staleProvider =
      providers.length === 0
        ? sql`0`
        : sql.join(
            providers.map(
              (provider) => sql`NOT EXISTS (SELECT 1 FROM segment_lookups sl
                WHERE sl.item_id = i.id AND sl.provider = ${provider}
                  AND (sl.outcome = 'found'
                    OR (sl.outcome = 'none' AND sl.checked_at > ${cutoff('none')})
                    OR (sl.outcome = 'error' AND sl.checked_at > ${cutoff('error')})))`,
            ),
            sql` OR `,
          )
    // The movie, or the episode's series, holds the ids the databases are asked with.
    const owner = sql`CASE i.kind WHEN 'episode' THEN (SELECT se.parent_id FROM items se
      WHERE se.id = i.parent_id) ELSE i.id END`
    return db
      .all<{ id: string }>(
        sql`SELECT i.id FROM items i
        WHERE +i.kind IN ('movie', 'episode')
          AND EXISTS (SELECT 1 FROM source_items si
            CROSS JOIN sources s ON s.id = si.source_id
            CROSS JOIN libraries l ON l.id = s.library_id
            WHERE si.item_id = i.id AND s.state = 'ready' AND l.detect_segments = 1)
          AND (
            NOT EXISTS (SELECT 1 FROM segment_lookups sl WHERE sl.item_id = i.id)
            OR (
              EXISTS (SELECT 1 FROM items o WHERE o.id = ${owner}
                AND (o.tmdb_id IS NOT NULL OR o.imdb_id IS NOT NULL OR o.tvdb_id IS NOT NULL))
              AND NOT EXISTS (SELECT 1 FROM source_items si
                CROSS JOIN sources s ON s.id = si.source_id
                CROSS JOIN source_items other ON other.source_id = si.source_id
                WHERE si.item_id = i.id AND s.state = 'ready' AND other.item_id <> i.id)
              -- A type still unknown: fewer settled segments and negative markers than types.
              AND (SELECT count(*) FROM segments sg WHERE sg.item_id = i.id
                    AND sg.origin IN ('manual', 'chapter', 'theintrodb', 'introdb', 'skipdb'))
                + (SELECT count(*) FROM segment_lookups sl WHERE sl.item_id = i.id
                    AND sl.provider LIKE 'no_segment:%') < ${segmentTypes.length}
              AND (${staleProvider})
            )
          )
        ORDER BY (SELECT min(sl.checked_at) FROM segment_lookups sl WHERE sl.item_id = i.id),
          i.created_at, i.id
        LIMIT ${limit}`,
      )
      .map((row) => row.id)
  },
})
