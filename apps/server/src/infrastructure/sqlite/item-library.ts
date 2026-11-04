import type { LeavingFiles } from '../../core/library/library.ts'
import type { Db } from './database.ts'
import { stripNulls } from './rows.ts'

export type DecidingLibrary = { libraryId: string; language?: string; ratingCountry: string }

const withTrees = `
  WITH top_of AS MATERIALIZED (
    SELECT i.id AS item_id, coalesce(g.id, p.id, i.id) AS top_id,
      i.tmdb_id AS tmdb_id, i.metadata_language AS metadata_language
    FROM items AS i
    LEFT JOIN items AS p ON p.id = i.parent_id
    LEFT JOIN items AS g ON g.id = p.parent_id
  ), deciding AS (
    SELECT top_id, library_id, language FROM (
      SELECT t.top_id AS top_id, l.id AS library_id, l.metadata_language AS language,
        row_number() OVER (PARTITION BY t.top_id ORDER BY l.created_at, l.id) AS rank
      FROM top_of AS t
      JOIN source_items AS si ON si.item_id = t.item_id
      JOIN sources AS s ON s.id = si.source_id
      JOIN libraries AS l ON l.id = s.library_id
    ) WHERE rank = 1
  )`

export const decidingLibraryOf = (db: Db, itemId: string): DecidingLibrary | undefined => {
  const row = db.$client
    .query<{ libraryId: string; language: string | null; ratingCountry: string }, [string]>(
      `WITH top AS (
         SELECT coalesce(g.id, p.id, i.id) AS id
         FROM items AS i
         LEFT JOIN items AS p ON p.id = i.parent_id
         LEFT JOIN items AS g ON g.id = p.parent_id
         WHERE i.id = ?1
       ), tree AS (
         SELECT id FROM top
         UNION SELECT c.id FROM top CROSS JOIN items AS c ON c.parent_id = top.id
         UNION SELECT e.id FROM top
           CROSS JOIN items AS c ON c.parent_id = top.id
           CROSS JOIN items AS e ON e.parent_id = c.id
       )
       SELECT l.id AS libraryId, l.metadata_language AS language, l.rating_country AS ratingCountry
       FROM tree
       CROSS JOIN source_items AS si ON si.item_id = tree.id
       CROSS JOIN sources AS s ON s.id = si.source_id
       CROSS JOIN libraries AS l ON l.id = s.library_id
       ORDER BY l.created_at, l.id
       LIMIT 1`,
    )
    .get(itemId)
  return row === null ? undefined : stripNulls(row)
}

export const staleLanguageTopLevel = (
  db: Db,
  { serverLanguage, libraryId }: { serverLanguage: string; libraryId?: string },
): string[] =>
  db.$client
    .query<{ id: string }, [string, string | null]>(
      `${withTrees}, langs AS (
         SELECT top_id, min(metadata_language) AS low, max(metadata_language) AS high,
           sum(metadata_language IS NULL) AS missing
         FROM top_of WHERE tmdb_id IS NOT NULL GROUP BY top_id
       )
       SELECT d.top_id AS id
       FROM deciding AS d
       CROSS JOIN items AS top ON top.id = d.top_id AND +top.parent_id IS NULL AND +top.tmdb_id IS NOT NULL
       CROSS JOIN langs AS g ON g.top_id = d.top_id
       WHERE (g.missing > 0 OR g.low IS NOT coalesce(d.language, ?1) OR g.high IS NOT coalesce(d.language, ?1))
         AND (?2 IS NULL OR EXISTS (
           SELECT 1 FROM top_of AS t
           JOIN source_items AS si ON si.item_id = t.item_id
           JOIN sources AS s ON s.id = si.source_id
           WHERE t.top_id = d.top_id AND s.library_id = ?2))
       ORDER BY d.top_id`,
    )
    .all(serverLanguage, libraryId ?? null)
    .map((row) => row.id)

export const topLevelDecidedBy = (db: Db, libraryId: string): string[] =>
  db.$client
    .query<{ id: string }, [string]>(
      `${withTrees}
       SELECT d.top_id AS id
       FROM deciding AS d
       CROSS JOIN items AS top ON top.id = d.top_id AND +top.parent_id IS NULL AND +top.tmdb_id IS NOT NULL
       WHERE d.library_id = ?1
       ORDER BY d.top_id`,
    )
    .all(libraryId)
    .map((row) => row.id)

export type TreeState = { topId: string; ratingCountry: string; stale: boolean }

export const treeStates = (
  db: Db,
  { topIds, serverLanguage }: { topIds: readonly string[]; serverLanguage: string },
): TreeState[] =>
  topIds.length === 0
    ? []
    : db.$client
        .query<{ topId: string; ratingCountry: string; stale: number }, [string, string]>(
          `WITH tops AS (
             SELECT DISTINCT value AS top_id FROM json_each(?1)
           ), tree AS MATERIALIZED (
             SELECT t.top_id AS top_id, i.id AS item_id, i.tmdb_id AS tmdb_id,
               i.metadata_language AS language, i.content_rating_country AS country
             FROM tops AS t CROSS JOIN items AS i ON i.id = t.top_id
             UNION ALL
             SELECT t.top_id, c.id, c.tmdb_id, c.metadata_language, c.content_rating_country
             FROM tops AS t CROSS JOIN items AS c ON c.parent_id = t.top_id
             UNION ALL
             SELECT t.top_id, e.id, e.tmdb_id, e.metadata_language, e.content_rating_country
             FROM tops AS t
             CROSS JOIN items AS c ON c.parent_id = t.top_id
             CROSS JOIN items AS e ON e.parent_id = c.id
           ), deciding AS (
             SELECT top_id, language, rating_country FROM (
               SELECT tree.top_id AS top_id, l.metadata_language AS language,
                 l.rating_country AS rating_country,
                 row_number() OVER (PARTITION BY tree.top_id ORDER BY l.created_at, l.id) AS rank
               FROM tree
               CROSS JOIN source_items AS si ON si.item_id = tree.item_id
               CROSS JOIN sources AS s ON s.id = si.source_id
               CROSS JOIN libraries AS l ON l.id = s.library_id
             ) WHERE rank = 1
           )
           SELECT d.top_id AS topId, d.rating_country AS ratingCountry,
             EXISTS (
               SELECT 1 FROM tree AS r
               CROSS JOIN tree AS top ON top.top_id = r.top_id AND top.item_id = r.top_id
               WHERE r.top_id = d.top_id AND r.tmdb_id IS NOT NULL
                 AND (r.language IS NOT coalesce(d.language, ?2)
                   OR r.country IS NOT top.country)
             ) AS stale
           FROM deciding AS d
           ORDER BY d.top_id`,
        )
        .all(JSON.stringify(topIds), serverLanguage)
        .map((row) => ({
          topId: row.topId,
          ratingCountry: row.ratingCountry,
          stale: row.stale === 1,
        }))

export const topLevelWithFiles = (db: Db, files: LeavingFiles): string[] => {
  const [scope, value] =
    'libraryId' in files
      ? ['s.library_id = ?1', files.libraryId]
      : 'rootIds' in files
        ? ['s.root_id IN (SELECT value FROM json_each(?1))', JSON.stringify(files.rootIds)]
        : ['s.id IN (SELECT value FROM json_each(?1))', JSON.stringify(files.sourceIds)]
  return db.$client
    .query<{ id: string }, [string]>(
      `SELECT DISTINCT top.id AS id
       FROM sources AS s
       CROSS JOIN source_items AS si ON si.source_id = s.id
       CROSS JOIN items AS i ON i.id = si.item_id
       LEFT JOIN items AS p ON p.id = i.parent_id
       LEFT JOIN items AS g ON g.id = p.parent_id
       CROSS JOIN items AS top ON top.id = coalesce(g.id, p.id, i.id)
       WHERE ${scope} AND top.parent_id IS NULL AND top.tmdb_id IS NOT NULL
       ORDER BY top.id`,
    )
    .all(value)
    .map((row) => row.id)
}
