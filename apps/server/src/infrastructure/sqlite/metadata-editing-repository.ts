import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { z } from 'zod'

import { genreIdSchema } from '@projo/shared/api/genres'

import { ownTitle } from '../../core/catalog/generic-titles.ts'
import type {
  ItemOverrideRepository,
  ItemOverrides,
  MetadataRefreshRepository,
} from '../../core/metadata/editing.ts'
import type { LockableField } from '../../core/metadata/enrichment.ts'
import { sortTitleOf } from '../../core/scanner/item-linking.ts'
import type { Db } from './database.ts'
import {
  decidingLibraryOf,
  staleLanguageTopLevel,
  topLevelDecidedBy,
  topLevelWithFiles,
  treeStates,
} from './item-library.ts'
import { fromIso, parseJsonColumn, stripNulls, toIso, toNullable } from './rows.ts'
import { itemOverrides, items } from './schema/items.ts'

/** `items.genres` and the `genres` override: projo genre ids (§9.1). */
const genresSchema = z.array(genreIdSchema)

/** `item_overrides.value` per field (JSON). */
const valueSchemas = {
  title: z.string(),
  year: z.number().int(),
  overview: z.string(),
  genres: genresSchema,
  poster_image_id: z.string(),
  backdrop_image_id: z.string(),
} satisfies Record<LockableField, z.ZodType>

const overrideKeys = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster_image_id: 'posterImageId',
  backdrop_image_id: 'backdropImageId',
} as const satisfies Record<LockableField, keyof ItemOverrides>

const lockableFields = Object.keys(overrideKeys) as LockableField[]

type ItemsSet = Partial<typeof items.$inferInsert>

/** The `items` columns an override (or a restored TMDB value) writes. */
const columnsOf = (values: {
  [K in keyof ItemOverrides]?: ItemOverrides[K] | undefined
}): ItemsSet => {
  const set: ItemsSet = {}
  if ('title' in values) {
    // A restored `undefined`: TMDB gives no name of its own (§6.3), '' in the NOT NULL column.
    set.title = values.title ?? ''
    set.sortTitle = sortTitleOf(values.title ?? '')
  }
  if ('year' in values) set.year = toNullable(values.year)
  if ('overview' in values) set.overview = toNullable(values.overview)
  if ('genres' in values) set.genres = values.genres ?? []
  if ('posterImageId' in values) set.posterImageId = toNullable(values.posterImageId)
  if ('backdropImageId' in values) set.backdropImageId = toNullable(values.backdropImageId)
  return set
}

/** Edits and locks (§9.3): `item_overrides` and the `items` columns they write. */
export const createSqliteItemOverrideRepository = ({ db }: { db: Db }): ItemOverrideRepository => ({
  item: (itemId) => {
    const row = db
      .select({
        id: items.id,
        kind: items.kind,
        tmdbId: items.tmdbId,
        title: items.title,
        seasonNumber: items.seasonNumber,
        episodeNumber: items.episodeNumber,
        year: items.year,
        overview: items.overview,
        genres: items.genres,
        posterImageId: items.posterImageId,
        backdropImageId: items.backdropImageId,
        metadataRefreshedAt: items.metadataRefreshedAt,
      })
      .from(items)
      .where(eq(items.id, itemId))
      .get()
    if (row === undefined) return undefined
    const { genres, metadataRefreshedAt, title, seasonNumber, episodeNumber, ...rest } =
      stripNulls(row)
    const own = ownTitle({ kind: rest.kind, title, seasonNumber, episodeNumber })
    return {
      ...rest,
      ...(own === undefined ? {} : { title: own }),
      genres: parseJsonColumn(genresSchema, genres, 'items.genres'),
      ...(metadataRefreshedAt === undefined
        ? {}
        : { metadataRefreshedAt: fromIso(metadataRefreshedAt) }),
    }
  },

  get: (itemId) => {
    const overrides: Record<string, unknown> = {}
    for (const row of db
      .select({ field: itemOverrides.field, value: itemOverrides.value })
      .from(itemOverrides)
      .where(eq(itemOverrides.itemId, itemId))
      .all()) {
      overrides[overrideKeys[row.field]] = parseJsonColumn(
        valueSchemas[row.field],
        row.value,
        `item_overrides.value (${row.field})`,
      )
    }
    return overrides as ItemOverrides
  },

  set: ({ itemId, overrides, at }) => {
    db.transaction((tx) => {
      for (const field of lockableFields) {
        const value = overrides[overrideKeys[field]]
        if (value === undefined) continue
        tx.insert(itemOverrides)
          .values({ itemId, field, value })
          .onConflictDoUpdate({
            target: [itemOverrides.itemId, itemOverrides.field],
            set: { value },
          })
          .run()
      }
      tx.update(items)
        .set({ ...columnsOf(overrides), updatedAt: toIso(at) })
        .where(eq(items.id, itemId))
        .run()
    })
  },

  remove: ({ itemId, field, restored, at }) => {
    db.transaction((tx) => {
      tx.delete(itemOverrides)
        .where(and(eq(itemOverrides.itemId, itemId), eq(itemOverrides.field, field)))
        .run()
      if (restored === undefined) return
      tx.update(items)
        .set({ ...columnsOf(restored), updatedAt: toIso(at) })
        .where(eq(items.id, itemId))
        .run()
    })
  },
})

/** What a refresh walks (§9.4). */
export const createSqliteMetadataRefreshRepository = ({
  db,
}: {
  db: Db
}): MetadataRefreshRepository => ({
  children: (itemId) =>
    db
      .select({
        id: items.id,
        kind: items.kind,
        tmdbId: items.tmdbId,
        parentId: items.parentId,
        seasonNumber: items.seasonNumber,
        episodeNumber: items.episodeNumber,
      })
      .from(items)
      .where(eq(items.parentId, itemId))
      .orderBy(items.seasonNumber, items.episodeNumber, items.id)
      .all()
      .map(stripNulls),

  libraryOf: (itemId) => {
    const library = decidingLibraryOf(db, itemId)
    return library === undefined
      ? undefined
      : {
          ratingCountry: library.ratingCountry,
          ...(library.language === undefined ? {} : { language: library.language }),
        }
  },

  staleLanguage: ({ serverLanguage, libraryId }) =>
    staleLanguageTopLevel(db, {
      serverLanguage,
      ...(libraryId === undefined ? {} : { libraryId }),
    }),

  decidedBy: (libraryId) => topLevelDecidedBy(db, libraryId),

  treeStates: (input) => treeStates(db, input),

  topLevelWithFiles: (files) => topLevelWithFiles(db, files),

  identifiedTopLevel: (libraryId) =>
    db.$client
      .query<{ id: string }, [string]>(
        `SELECT DISTINCT top.id AS id
         FROM sources s
         JOIN source_items si ON si.source_id = s.id
         JOIN items i ON i.id = si.item_id
         LEFT JOIN items season ON season.id = i.parent_id
         JOIN items top ON top.id = CASE WHEN i.kind = 'episode' THEN season.parent_id ELSE i.id END
         WHERE s.library_id = ?1 AND top.parent_id IS NULL AND top.tmdb_id IS NOT NULL
         ORDER BY top.id`,
      )
      .all(libraryId)
      .map((row) => row.id),

  inProductionSeriesRefreshedBefore: (before) =>
    db
      .select({ id: items.id })
      .from(items)
      .where(
        and(
          eq(items.kind, 'series'),
          isNull(items.parentId),
          isNotNull(items.tmdbId),
          eq(items.seriesStatus, 'in_production'),
          or(isNull(items.metadataRefreshedAt), lt(items.metadataRefreshedAt, toIso(before))),
        ),
      )
      .orderBy(items.metadataRefreshedAt, items.id)
      .all()
      .map((row) => row.id),
})
