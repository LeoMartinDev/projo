import { and, asc, type Column, eq, inArray, type SQL, sql } from 'drizzle-orm'

import { ownTitle } from '../../core/catalog/generic-titles.ts'
import { type EditableField, editableFieldOf } from '../../core/metadata/editing.ts'
import type {
  CatalogEpisodeRow,
  CatalogItemKind,
  CatalogItemRow,
  CatalogItems,
  FileCounts,
} from '../../core/metadata/catalog-items.ts'
import { afterPosition, orderBy, sortColumns } from './catalog.ts'
import type { Db } from './database.ts'
import { chunks, fromIso, stripNulls } from './rows.ts'
import { itemOverrides, items } from './schema/items.ts'
import { libraries } from './schema/libraries.ts'

// A title's files are those of its movie, or of the episodes under its seasons.
const linkedFiles = sql.raw('source_items si CROSS JOIN sources s ON s.id = si.source_id')
const showFiles = sql.raw(
  `items se CROSS JOIN items e ON e.parent_id = se.id
    CROSS JOIN source_items si ON si.item_id = e.id CROSS JOIN sources s ON s.id = si.source_id`,
)
const counted = sql.raw(`s.state IN ('ready', 'missing')`)

const inLibrary = (libraryId: string): SQL =>
  sql`((${items.kind} = 'movie' AND EXISTS (SELECT 1 FROM ${linkedFiles}
      WHERE si.item_id = ${items.id} AND s.library_id = ${libraryId} AND ${counted}))
    OR (${items.kind} = 'series' AND EXISTS (SELECT 1 FROM ${showFiles}
      WHERE se.parent_id = ${items.id} AND +se.kind = 'season' AND +e.kind = 'episode'
        AND s.library_id = ${libraryId} AND ${counted})))`

const matching = (search: string): SQL =>
  sql`${items.id} IN (SELECT search_documents.item_id FROM items_fts
    CROSS JOIN search_documents ON search_documents.id = items_fts.rowid
    WHERE items_fts MATCH ${search})`

const idList = (ids: readonly string[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )

const noFiles = (): FileCounts => ({ ready: 0, missing: 0 })

const addFiles = (counts: FileCounts, state: string, count: number): FileCounts =>
  state === 'ready'
    ? { ...counts, ready: counts.ready + count }
    : state === 'missing'
      ? { ...counts, missing: counts.missing + count }
      : counts

const topLevelKind = (kind: string): CatalogItemKind => {
  if (kind === 'movie' || kind === 'series') return kind
  throw new Error(`catalog item of kind ${kind}`)
}

const lockedFields = (db: Db, ids: readonly string[]): Map<string, EditableField[]> => {
  const locked = new Map<string, EditableField[]>()
  for (const chunk of chunks(ids)) {
    for (const { itemId, field } of db
      .select({ itemId: itemOverrides.itemId, field: itemOverrides.field })
      .from(itemOverrides)
      .where(inArray(itemOverrides.itemId, chunk))
      .all()) {
      locked.set(itemId, [...(locked.get(itemId) ?? []), editableFieldOf[field]])
    }
  }
  return locked
}

type FileRow = { itemId: string; libraryId: string; state: string; count: number }

/** Files per top-level id, by library and state: a movie's own, a show's through its episodes. */
const topLevelFiles = (db: Db, ids: readonly string[]): FileRow[] =>
  chunks(ids).flatMap((chunk) =>
    db.all<FileRow>(
      sql`SELECT si.item_id AS itemId, s.library_id AS libraryId, s.state AS state, count(*) AS count
        FROM ${linkedFiles}
        WHERE si.item_id IN (${idList(chunk)}) AND ${counted}
        GROUP BY si.item_id, s.library_id, s.state
      UNION ALL
      SELECT se.parent_id AS itemId, s.library_id AS libraryId, s.state AS state,
          count(DISTINCT s.id) AS count
        FROM ${showFiles}
        WHERE se.parent_id IN (${idList(chunk)}) AND +se.kind = 'season' AND +e.kind = 'episode'
          AND ${counted}
        GROUP BY se.parent_id, s.library_id, s.state`,
    ),
  )

type ShowCounts = { seriesId: string; seasons: number; episodes: number }

const showCounts = (db: Db, ids: readonly string[]): Map<string, ShowCounts> =>
  new Map(
    chunks(ids)
      .flatMap((chunk) =>
        db.all<ShowCounts>(
          sql`SELECT se.parent_id AS seriesId, count(DISTINCT se.id) AS seasons, count(e.id) AS episodes
            FROM items se CROSS JOIN items e ON e.parent_id = se.id
            WHERE se.parent_id IN (${idList(chunk)}) AND +se.kind = 'season' AND +e.kind = 'episode'
            GROUP BY se.parent_id`,
        ),
      )
      .map((row) => [row.seriesId, row]),
  )

const episodeFiles = (db: Db, ids: readonly string[]): Map<string, FileCounts> => {
  const files = new Map<string, FileCounts>()
  for (const chunk of chunks(ids)) {
    for (const row of db.all<Omit<FileRow, 'libraryId'>>(
      sql`SELECT si.item_id AS itemId, s.state AS state, count(*) AS count
        FROM ${linkedFiles}
        WHERE si.item_id IN (${idList(chunk)}) AND ${counted}
        GROUP BY si.item_id, s.state`,
    )) {
      files.set(row.itemId, addFiles(files.get(row.itemId) ?? noFiles(), row.state, row.count))
    }
  }
  return files
}

const byNumber = (column: Column): SQL[] => [
  sql`coalesce(${column}, 1000000)`,
  sql`${items.sortTitle} COLLATE NOCASE`,
  sql`${items.id}`,
]

export const createSqliteCatalogItems = ({ db }: { db: Db }): CatalogItems => ({
  list: ({ kind, search, libraryId, sort, order, after, limit }) => {
    const columns = sortColumns(sort, order)
    const rows = db
      .select({
        id: items.id,
        kind: items.kind,
        title: items.title,
        sortTitle: items.sortTitle,
        year: items.year,
        posterImageId: items.posterImageId,
        tmdbId: items.tmdbId,
        episodeCountTmdb: items.episodeCountTmdb,
        addedAt: items.addedAt,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(
        and(
          kind === undefined ? inArray(items.kind, ['movie', 'series']) : eq(items.kind, kind),
          ...(search === undefined ? [] : [matching(search)]),
          ...(libraryId === undefined ? [] : [inLibrary(libraryId)]),
          ...(after === undefined ? [] : [afterPosition(columns, after)]),
        ),
      )
      .orderBy(...orderBy(columns))
      .limit(limit)
      .all()
    const ids = rows.map((row) => row.id)
    const names = new Map(
      db
        .select({ id: libraries.id, name: libraries.name })
        .from(libraries)
        .all()
        .map((library) => [library.id, library.name]),
    )
    const files = new Map<string, FileCounts>()
    const libraryIds = new Map<string, Set<string>>()
    for (const row of topLevelFiles(db, ids)) {
      files.set(row.itemId, addFiles(files.get(row.itemId) ?? noFiles(), row.state, row.count))
      libraryIds.set(row.itemId, (libraryIds.get(row.itemId) ?? new Set()).add(row.libraryId))
    }
    const shows = showCounts(
      db,
      rows.filter((row) => row.kind === 'series').map((row) => row.id),
    )
    const locked = lockedFields(db, ids)
    return rows.map((row): CatalogItemRow => {
      const { addedAt, createdAt, kind: rowKind, ...rest } = stripNulls(row)
      const itemKind = topLevelKind(rowKind)
      const show = shows.get(row.id)
      return {
        ...rest,
        kind: itemKind,
        libraries: [...(libraryIds.get(row.id) ?? [])]
          .map((id) => ({ id, name: names.get(id) ?? id }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        files: files.get(row.id) ?? noFiles(),
        ...(itemKind === 'series'
          ? { seasons: show?.seasons ?? 0, episodes: show?.episodes ?? 0 }
          : {}),
        locked: locked.get(row.id) ?? [],
        createdAt: fromIso(createdAt),
        ...(addedAt === undefined ? {} : { addedAt: fromIso(addedAt) }),
      }
    })
  },

  kindOf: (itemId) =>
    db.select({ kind: items.kind }).from(items).where(eq(items.id, itemId)).get()?.kind,

  seasons: (seriesId) => {
    const seasons = db
      .select({ id: items.id, title: items.title, seasonNumber: items.seasonNumber })
      .from(items)
      .where(and(eq(items.parentId, seriesId), eq(items.kind, 'season')))
      .orderBy(...byNumber(items.seasonNumber))
      .all()
      .map((row) => stripNulls(row))
    const episodes = chunks(seasons.map((season) => season.id)).flatMap((chunk) =>
      db
        .select({
          id: items.id,
          parentId: items.parentId,
          title: items.title,
          episodeNumber: items.episodeNumber,
          airDate: items.airDate,
          stillImageId: items.stillImageId,
        })
        .from(items)
        .where(and(inArray(items.parentId, chunk), eq(items.kind, 'episode')))
        .orderBy(...byNumber(items.episodeNumber), asc(items.parentId))
        .all()
        .map((row) => stripNulls(row)),
    )
    const files = episodeFiles(
      db,
      episodes.map((episode) => episode.id),
    )
    const locked = lockedFields(db, [
      ...seasons.map((season) => season.id),
      ...episodes.map((episode) => episode.id),
    ])
    return seasons.map(({ id, title, seasonNumber }) => {
      const own = ownTitle({ kind: 'season', title, seasonNumber })
      return {
        id,
        ...(seasonNumber === undefined ? {} : { seasonNumber }),
        ...(own === undefined ? {} : { title: own }),
        locked: locked.get(id) ?? [],
        episodes: episodes
          .filter((episode) => episode.parentId === id)
          .map(({ parentId: _parent, title: episodeTitle, ...episode }): CatalogEpisodeRow => {
            const ownEpisode = ownTitle({
              kind: 'episode',
              title: episodeTitle,
              episodeNumber: episode.episodeNumber,
            })
            return {
              ...episode,
              ...(ownEpisode === undefined ? {} : { title: ownEpisode }),
              files: files.get(episode.id) ?? noFiles(),
              locked: locked.get(episode.id) ?? [],
            }
          }),
      }
    })
  },
})
