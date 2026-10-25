import { and, asc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'

import { type GenreId, genreIdSchema } from '@projo/shared/api/genres'

import {
  bestQuality,
  type CatalogFilters,
  type CatalogItem,
  type CatalogPosition,
  type CatalogRepository,
  type CatalogSort,
  episodeRangeEnd,
  type EpisodeRef,
  type ItemPerson,
  isPlayableKind,
  missingSortValue,
  type PlayableSource,
  resolutionOf,
  type SortOrder,
  type VideoQuality,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import { ownTitle } from '../../core/catalog/generic-titles.ts'
import { sourceVersionOf } from '../../core/media/version.ts'
import { progressRules } from '../../core/progress/progress.ts'
import { readMediaInfo } from '../playback/probe-reader.ts'
import {
  episodeVisible,
  ratingOf,
  ratingOfItemId,
  readySourceIn,
  visible,
  visibleEpisodesOfSeries,
} from './catalog-sql.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn, stripNulls } from './rows.ts'
import { readParsedEdition } from './source-columns.ts'
import { itemPeople, items, people } from './schema/items.ts'
import {
  libraries,
  libraryRoots,
  sourceItems,
  sources,
  sourceSubtitles,
} from './schema/libraries.ts'
import { segments } from './schema/playback.ts'

export { visible } from './catalog-sql.ts'

/**
 * Read side of the catalog (§6.3). Every query goes through `visible(scope)`: an item without a
 * ready source (transitively for seasons and series), or outside the profile's scope, does not
 * exist for the user API.
 */

/**
 * §13.5 search tables, created by the custom migration `search` (not in the Drizzle schema:
 * FTS5 is not expressible there). `search_documents.id` is the FTS rowid of a movie or a series.
 */
const searchDocuments = sqliteTable('search_documents', {
  id: integer().primaryKey(),
  itemId: text().notNull(),
})
const itemsFts = sqliteTable('items_fts', { rowid: integer().notNull(), rank: real().notNull() })

/** `items.genres`: projo genre ids (§9.1), written by the TMDB enrichment and the admin edits. */
const genresSchema = z.array(genreIdSchema)

type ItemRow = typeof items.$inferSelect

export const toCatalogItem = (row: ItemRow): CatalogItem => {
  const {
    genres,
    addedAt,
    createdAt,
    updatedAt: _u,
    metadataRefreshedAt: _m,
    tmdbId: _t,
    imdbId: _i,
    tvdbId: _v,
    title,
    ...rest
  } = stripNulls(row)
  // '' and the placeholders of older rows ("Episode 7", "Season 1") read as no title of its own.
  const own = ownTitle({ ...rest, title })
  return {
    ...rest,
    ...(own === undefined ? {} : { title: own }),
    genres: parseJsonColumn(genresSchema, genres, 'items.genres'),
    createdAt: fromIso(createdAt),
    ...(addedAt === undefined ? {} : { addedAt: fromIso(addedAt) }),
  }
}

const addedKey = sql`coalesce(${items.addedAt}, ${items.createdAt})`
const titleKey = sql`${items.sortTitle} COLLATE NOCASE`

type SortKey = { expr: SQL; descending: boolean }

/**
 * Keyset columns of a sort: the key(s) of `sortKeys` then the id. Year and rating put unknown
 * values last and break ties by title A→Z.
 */
const sortColumns = (sort: CatalogSort, order: SortOrder): SortKey[] => {
  const descending = order === 'desc'
  const missing = missingSortValue(order)
  switch (sort) {
    case 'title':
      return [
        { expr: titleKey, descending },
        { expr: sql`${items.id}`, descending },
      ]
    case 'added':
      return [
        { expr: addedKey, descending },
        { expr: sql`${items.id}`, descending },
      ]
    case 'year':
    case 'rating':
      return [
        {
          expr: sql`coalesce(${sort === 'year' ? items.year : items.voteAverage}, ${missing})`,
          descending,
        },
        { expr: titleKey, descending: false },
        { expr: sql`${items.id}`, descending: false },
      ]
  }
}

/** Rows strictly after `position` in the order of `columns`. */
const afterPosition = (columns: SortKey[], position: CatalogPosition): SQL => {
  const values = [...position.keys, position.id]
  const branches = columns.map((column, index) => {
    const equal = columns
      .slice(0, index)
      .map((previous, at) => sql`${previous.expr} = ${values[at]}`)
    const beyond = sql`${column.expr} ${column.descending ? sql`<` : sql`>`} ${values[index]}`
    return sql`(${sql.join([...equal, beyond], sql` AND `)})`
  })
  return sql`(${sql.join(branches, sql` OR `)})`
}

const orderBy = (columns: SortKey[]): SQL[] =>
  columns.map((column) => sql`${column.expr} ${column.descending ? sql`DESC` : sql`ASC`}`)

/** `unwatched` / `in_progress` / `watched` of the movie or episode `alias` for a profile (§13.1). */
const watchState = (alias: SQL, profileId: string): SQL =>
  sql`coalesce((SELECT CASE
    WHEN p.duration_ms > 0 AND p.position_ms >= ${progressRules.resumeFromRatio} * p.duration_ms AND p.position_ms < ${progressRules.watchedAtRatio} * p.duration_ms THEN 'in_progress'
    WHEN p.watched = 1 THEN 'watched' ELSE 'unwatched' END
    FROM playback_progress p WHERE p.profile_id = ${profileId} AND p.item_id = ${alias}), 'unwatched')`

const watchFilter = (
  kind: 'movie' | 'series',
  watch: NonNullable<CatalogFilters['watch']>,
  profileId: string,
  scope: VisibilityScope,
): SQL => {
  if (kind === 'movie') return sql`${watchState(sql`${items.id}`, profileId)} = ${watch}`
  // A series from its visible episodes (§13.1, `aggregateWatchStatus`): `in_progress` = partly.
  const anyEpisode = (not: string) =>
    sql`EXISTS (SELECT 1 FROM ${visibleEpisodesOfSeries('items', scope)} AND ${watchState(sql`e.id`, profileId)} <> ${not})`
  switch (watch) {
    case 'watched':
      return sql`NOT ${anyEpisode('watched')}`
    case 'unwatched':
      return sql`NOT ${anyEpisode('unwatched')}`
    case 'in_progress':
      return sql`(${anyEpisode('watched')} AND ${anyEpisode('unwatched')})`
  }
}

const filterConditions = (
  kind: 'movie' | 'series',
  filters: CatalogFilters,
  profileId: string,
  scope: VisibilityScope,
): SQL[] => [
  ...(filters.genre === undefined
    ? []
    : [sql`EXISTS (SELECT 1 FROM json_each(${items.genres}) g WHERE g.value = ${filters.genre})`]),
  ...(filters.year === undefined ? [] : [eq(items.year, filters.year)]),
  ...(filters.decade === undefined
    ? []
    : [sql`${items.year} BETWEEN ${filters.decade} AND ${filters.decade + 9}`]),
  ...(filters.watch === undefined ? [] : [watchFilter(kind, filters.watch, profileId, scope)]),
]

type SourceRow = {
  source: typeof sources.$inferSelect
  rootPath: string
  rootState: 'ok' | 'unreachable'
}

const joinPath = (root: string, relative: string): string =>
  `${root.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`

const toPlayableSource = ({ source, rootPath, rootState }: SourceRow): PlayableSource => {
  const media = readMediaInfo(source.probe)
  return {
    id: source.id,
    state: source.state,
    libraryId: source.libraryId,
    path: joinPath(rootPath, source.relativePath),
    rootReachable: rootState === 'ok',
    extension: source.extension.replace(/^\./, '').toLowerCase(),
    sizeBytes: source.sizeBytes,
    mtime: source.mtime,
    version: sourceVersionOf(media?.video[0], readParsedEdition(source.parsed)),
    ...(source.stackGroupId === null ? {} : { stackGroupId: source.stackGroupId }),
    ...(source.partIndex === null ? {} : { partIndex: source.partIndex }),
    ...(media === undefined ? {} : { media }),
  }
}

const bestSourceOrder = [
  sql`coalesce(${sources.partIndex}, 0)`,
  sql`${sources.sizeBytes} DESC`,
  asc(sources.id),
]

/** Chunked `IN (…)`: SQLite caps bound parameters. */
const chunks = <T>(values: readonly T[], size = 500): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size))
  return result
}

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)]

/**
 * Adds `durationMs` to movies and episodes: the probed duration of their best ready source, in
 * one query per list (cards show it when TMDB has no runtime).
 */
const withDurations =
  (db: Db, scope: VisibilityScope) =>
  (list: CatalogItem[]): CatalogItem[] => {
    const ids = list.filter((item) => isPlayableKind(item.kind)).map((item) => item.id)
    if (ids.length === 0) return list
    const durations = new Map<string, number>()
    for (const chunk of chunks(ids)) {
      const rows = db
        .select({ itemId: sourceItems.itemId, probe: sources.probe })
        .from(sourceItems)
        .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
        .innerJoin(libraries, eq(libraries.id, sources.libraryId))
        .where(
          and(
            inArray(sourceItems.itemId, chunk),
            readySourceIn(scope, ratingOfItemId(sql`${sourceItems.itemId}`)),
          ),
        )
        .orderBy(asc(sourceItems.itemId), ...bestSourceOrder)
        .all()
      for (const { itemId, probe } of rows) {
        if (durations.has(itemId)) continue
        const durationMs = readMediaInfo(probe)?.durationMs
        if (durationMs !== undefined && durationMs > 0) durations.set(itemId, durationMs)
      }
    }
    return list.map((item) => {
      const durationMs = durations.get(item.id)
      return durationMs === undefined ? item : { ...item, durationMs }
    })
  }

/**
 * §8.4: an episode whose best ready source (the `withDurations` order) also holds the next
 * episodes of its season gets `episodeNumberEnd` ("E01-E02").
 */
const withEpisodeRanges =
  (db: Db, scope: VisibilityScope) =>
  (list: CatalogItem[]): CatalogItem[] => {
    const episodes = list.filter(
      (item) => item.kind === 'episode' && item.episodeNumber !== undefined,
    )
    if (episodes.length === 0) return list
    const bestSource = new Map<string, string>()
    for (const chunk of chunks(episodes.map((item) => item.id))) {
      const rows = db
        .select({ itemId: sourceItems.itemId, sourceId: sourceItems.sourceId })
        .from(sourceItems)
        .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
        .innerJoin(libraries, eq(libraries.id, sources.libraryId))
        .where(
          and(
            inArray(sourceItems.itemId, chunk),
            readySourceIn(scope, ratingOfItemId(sql`${sourceItems.itemId}`)),
          ),
        )
        .orderBy(asc(sourceItems.itemId), ...bestSourceOrder)
        .all()
      for (const { itemId, sourceId } of rows)
        if (!bestSource.has(itemId)) bestSource.set(itemId, sourceId)
    }
    // Episode numbers each of those files holds, per season.
    const covered = new Map<string, Set<number>>()
    for (const chunk of chunks(unique(bestSource.values()))) {
      const rows = db
        .select({
          sourceId: sourceItems.sourceId,
          parentId: items.parentId,
          episodeNumber: items.episodeNumber,
        })
        .from(sourceItems)
        .innerJoin(items, eq(items.id, sourceItems.itemId))
        .where(and(inArray(sourceItems.sourceId, chunk), eq(items.kind, 'episode')))
        .all()
      for (const { sourceId, parentId, episodeNumber } of rows) {
        if (parentId === null || episodeNumber === null) continue
        const key = `${sourceId}/${parentId}`
        const numbers = covered.get(key) ?? new Set<number>()
        numbers.add(episodeNumber)
        covered.set(key, numbers)
      }
    }
    return list.map((item) => {
      const sourceId = bestSource.get(item.id)
      if (sourceId === undefined || item.episodeNumber === undefined) return item
      const numbers = covered.get(`${sourceId}/${item.parentId ?? ''}`)
      const episodeNumberEnd =
        numbers === undefined ? undefined : episodeRangeEnd(item.episodeNumber, numbers)
      return episodeNumberEnd === undefined ? item : { ...item, episodeNumberEnd }
    })
  }

const sourceColumns = {
  source: sources,
  rootPath: libraryRoots.path,
  rootState: libraryRoots.state,
}

export const createSqliteCatalogRepository = ({ db }: { db: Db }): CatalogRepository => {
  const findManyVisible: CatalogRepository['findManyVisible'] = ({ ids, scope }) =>
    withDurations(
      db,
      scope,
    )(
      chunks(unique(ids)).flatMap((chunk) =>
        db
          .select()
          .from(items)
          .where(and(inArray(items.id, chunk), visible(scope)))
          .all()
          .map(toCatalogItem),
      ),
    )

  /** Visible episodes under seasons or series (ids), with the container they were found under. */
  const listVisibleEpisodeIds: CatalogRepository['listVisibleEpisodeIds'] = ({
    ancestorIds,
    scope,
  }) =>
    chunks(ancestorIds).flatMap((chunk) => {
      const ids = sql.join(
        chunk.map((id) => sql`${id}`),
        sql`, `,
      )
      return db.all<{ episodeId: string; ancestorId: string }>(sql`
        SELECT e.id AS episodeId, e.parent_id AS ancestorId FROM items e
          WHERE e.parent_id IN (${ids}) AND +e.kind = 'episode' AND ${episodeVisible('e', scope)}
        UNION ALL
        SELECT e.id AS episodeId, se.parent_id AS ancestorId FROM items se CROSS JOIN items e ON e.parent_id = se.id
          WHERE se.parent_id IN (${ids}) AND +se.kind = 'season' AND +e.kind = 'episode' AND ${episodeVisible('e', scope)}
      `)
    })

  return {
    listTopLevel: ({ kind, sort, order, after, limit, scope, filters = {}, profileId = '' }) => {
      const columns = sortColumns(sort, order)
      const rows = db
        .select()
        .from(items)
        .where(
          and(
            eq(items.kind, kind),
            visible(scope),
            ...filterConditions(kind, filters, profileId, scope),
            ...(after === undefined ? [] : [afterPosition(columns, after)]),
          ),
        )
        .orderBy(...orderBy(columns))
        .limit(limit)
        .all()
        .map(toCatalogItem)
      return withDurations(db, scope)(rows)
    },

    listRecentlyAdded: ({ limit, scope }) =>
      db
        .select()
        .from(items)
        .where(and(inArray(items.kind, ['movie', 'series']), visible(scope)))
        .orderBy(sql`${addedKey} DESC`, sql`${items.id} DESC`)
        .limit(limit)
        .all()
        .map(toCatalogItem),

    findVisible: ({ id, scope }) => {
      const row = db
        .select()
        .from(items)
        .where(and(eq(items.id, id), visible(scope)))
        .get()
      return row && withDurations(db, scope)([toCatalogItem(row)])[0]
    },

    findManyVisible,

    listGenres: ({ kind, scope }) =>
      db
        .all<{ genre: unknown }>(
          sql`SELECT DISTINCT g.value AS genre FROM items, json_each(items.genres) g
            WHERE ${kind === undefined ? sql`items.kind IN ('movie', 'series')` : sql`items.kind = ${kind}`}
              AND ${visible(scope)}`,
        )
        .map(({ genre }): GenreId => parseJsonColumn(genreIdSchema, genre, 'items.genres')),

    yearRange: ({ kind, scope }) => {
      const [row] = db.all<{ min: number | null; max: number | null }>(
        sql`SELECT min(items.year) AS min, max(items.year) AS max FROM items
          WHERE ${kind === undefined ? sql`items.kind IN ('movie', 'series')` : sql`items.kind = ${kind}`}
            AND items.year IS NOT NULL AND ${visible(scope)}`,
      )
      return row === undefined || row.min === null || row.max === null
        ? undefined
        : { min: row.min, max: row.max }
    },

    bestQualities: ({ itemIds, scope }) => {
      const found = new Map<string, VideoQuality[]>()
      for (const chunk of chunks(itemIds)) {
        const rows = db
          .select({ itemId: sourceItems.itemId, probe: sources.probe })
          .from(sourceItems)
          .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
          .innerJoin(libraries, eq(libraries.id, sources.libraryId))
          .where(
            and(
              inArray(sourceItems.itemId, chunk),
              readySourceIn(scope, ratingOfItemId(sql`${sourceItems.itemId}`)),
            ),
          )
          .all()
        for (const { itemId, probe } of rows) {
          const video = readMediaInfo(probe)?.video[0]
          const resolution = resolutionOf(video?.width, video?.height)
          if (resolution === undefined) continue
          found.set(itemId, [
            ...(found.get(itemId) ?? []),
            { resolution, dynamicRange: video?.dynamicRange ?? 'sdr' },
          ])
        }
      }
      const best = new Map<string, VideoQuality>()
      for (const [itemId, qualities] of found) {
        const quality = bestQuality(qualities)
        if (quality !== undefined) best.set(itemId, quality)
      }
      return best
    },

    search: ({ expression, limit, scope }) =>
      db
        .select({ item: items })
        .from(itemsFts)
        .innerJoin(searchDocuments, eq(searchDocuments.id, itemsFts.rowid))
        .innerJoin(items, eq(items.id, searchDocuments.itemId))
        .where(
          and(
            sql`"items_fts" MATCH ${expression}`,
            inArray(items.kind, ['movie', 'series']),
            visible(scope),
          ),
        )
        .orderBy(asc(itemsFts.rank), sql`${titleKey}`, asc(items.id))
        .limit(limit)
        .all()
        .map(({ item }) => toCatalogItem(item)),

    listSeriesEpisodes: ({ seriesIds, scope }) =>
      chunks(seriesIds).flatMap((chunk) =>
        db
          .all<{
            id: string
            seriesId: string
            seasonNumber: number | null
            episodeNumber: number | null
            addedAt: string | null
          }>(
            sql`SELECT e.id AS id, se.parent_id AS seriesId,
                coalesce(e.season_number, se.season_number) AS seasonNumber,
                e.episode_number AS episodeNumber, e.added_at AS addedAt
              FROM items se CROSS JOIN items e ON e.parent_id = se.id
              WHERE se.parent_id IN (${sql.join(
                chunk.map((id) => sql`${id}`),
                sql`, `,
              )}) AND +se.kind = 'season' AND +e.kind = 'episode' AND ${episodeVisible('e', scope)}
              ORDER BY se.parent_id, coalesce(e.season_number, se.season_number, 1000000),
                coalesce(e.episode_number, 1000000), e.sort_title COLLATE NOCASE, e.id`,
          )
          .map((row): EpisodeRef => ({
            id: row.id,
            seriesId: row.seriesId,
            ...(row.seasonNumber === null ? {} : { seasonNumber: row.seasonNumber }),
            ...(row.episodeNumber === null ? {} : { episodeNumber: row.episodeNumber }),
            ...(row.addedAt === null ? {} : { addedAt: fromIso(row.addedAt) }),
          })),
      ),

    listVisibleChildren: ({ parentId, scope }) =>
      withEpisodeRanges(
        db,
        scope,
      )(
        withDurations(
          db,
          scope,
        )(
          db
            .select()
            .from(items)
            .where(and(eq(items.parentId, parentId), visible(scope)))
            .orderBy(
              sql`coalesce(${items.seasonNumber}, 1000000)`,
              sql`coalesce(${items.episodeNumber}, 1000000)`,
              sql`${items.sortTitle} COLLATE NOCASE`,
              asc(items.id),
            )
            .all()
            .map(toCatalogItem),
        ),
      ),

    listVisibleEpisodeIds,

    listPeople: (itemId) =>
      db
        .select({
          id: people.id,
          name: people.name,
          role: itemPeople.role,
          character: itemPeople.character,
          order: itemPeople.order,
          profileImageId: people.profileImageId,
        })
        .from(itemPeople)
        .innerJoin(people, eq(people.id, itemPeople.personId))
        .where(eq(itemPeople.itemId, itemId))
        .orderBy(
          sql`CASE ${itemPeople.role} WHEN 'cast' THEN 0 WHEN 'director' THEN 1 ELSE 2 END`,
          asc(itemPeople.order),
          asc(people.name),
        )
        .all()
        .map((row): ItemPerson => stripNulls(row)),

    describeMedia: ({ itemId, scope }) => {
      const item = db.select({ kind: items.kind }).from(items).where(eq(items.id, itemId)).get()
      if (item === undefined) return { audioLanguages: [], subtitleLanguages: [] }
      const playableIds = isPlayableKind(item.kind)
        ? [itemId]
        : listVisibleEpisodeIds({ ancestorIds: [itemId], scope }).map((row) => row.episodeId)
      const rows = chunks(playableIds).flatMap((chunk) =>
        db
          .select({ id: sources.id, probe: sources.probe })
          .from(sourceItems)
          .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
          .innerJoin(libraries, eq(libraries.id, sources.libraryId))
          .innerJoin(items, eq(items.id, sourceItems.itemId))
          .where(and(inArray(sourceItems.itemId, chunk), readySourceIn(scope, ratingOf('items'))))
          .orderBy(asc(sourceItems.itemId), ...bestSourceOrder)
          .all(),
      )
      const qualities: VideoQuality[] = []
      const audio: string[] = []
      const subtitles: string[] = []
      for (const row of rows) {
        const media = readMediaInfo(row.probe)
        const video = media?.video[0]
        const resolution = resolutionOf(video?.width, video?.height)
        if (resolution !== undefined) {
          qualities.push({ resolution, dynamicRange: video?.dynamicRange ?? 'sdr' })
        }
        for (const stream of media?.audio ?? []) {
          if (stream.language !== undefined) audio.push(stream.language)
        }
        for (const stream of media?.subtitles ?? []) {
          if (stream.language !== undefined) subtitles.push(stream.language)
        }
      }
      for (const chunk of chunks(rows.map((row) => row.id))) {
        for (const { language } of db
          .select({ language: sourceSubtitles.language })
          .from(sourceSubtitles)
          .where(inArray(sourceSubtitles.sourceId, chunk))
          .all()) {
          if (language !== null && language !== '' && language !== 'und') subtitles.push(language)
        }
      }
      const best = bestQuality(qualities)
      return {
        ...(best === undefined ? {} : { bestQuality: best }),
        audioLanguages: unique(audio),
        subtitleLanguages: unique(subtitles),
      }
    },

    isImageVisible: ({ imageId, scope }) => {
      const usedBy = (column: SQL) =>
        sql`EXISTS (SELECT 1 FROM items WHERE ${column} = ${imageId} AND ${visible(scope)})`
      const [row] = db.all<{ found: number }>(sql`SELECT (
        ${usedBy(sql`items.poster_image_id`)} OR ${usedBy(sql`items.backdrop_image_id`)}
        OR ${usedBy(sql`items.logo_image_id`)} OR ${usedBy(sql`items.still_image_id`)}
        OR EXISTS (SELECT 1 FROM people pe CROSS JOIN item_people ip ON ip.person_id = pe.id
          CROSS JOIN items ON items.id = ip.item_id
          WHERE pe.profile_image_id = ${imageId} AND ${visible(scope)})
      ) AS found`)
      return row?.found === 1
    },

    listReadySources: ({ itemId, scope }) =>
      db
        .select(sourceColumns)
        .from(sourceItems)
        .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
        .innerJoin(libraryRoots, eq(libraryRoots.id, sources.rootId))
        .innerJoin(libraries, eq(libraries.id, sources.libraryId))
        .where(
          and(eq(sourceItems.itemId, itemId), readySourceIn(scope, ratingOfItemId(sql`${itemId}`))),
        )
        .orderBy(...bestSourceOrder)
        .all()
        .map(toPlayableSource),

    findSource: (sourceId) => {
      const row = db
        .select(sourceColumns)
        .from(sources)
        .innerJoin(libraryRoots, eq(libraryRoots.id, sources.rootId))
        .where(eq(sources.id, sourceId))
        .get()
      return row && toPlayableSource(row)
    },

    listSourceItemIds: (sourceId) =>
      db
        .select({ itemId: sourceItems.itemId })
        .from(sourceItems)
        .where(eq(sourceItems.sourceId, sourceId))
        .all()
        .map((row) => row.itemId),

    listMediaSegments: (itemId) =>
      db
        .select({ type: segments.type, startMs: segments.startMs, endMs: segments.endMs })
        .from(segments)
        .where(eq(segments.itemId, itemId))
        .orderBy(asc(segments.startMs))
        .all(),
  }
}
