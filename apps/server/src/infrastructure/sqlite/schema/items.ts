import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { libraries, sources } from './libraries.ts'

// §6.3 Items and metadata

export const images = sqliteTable(
  'images',
  {
    id: text().primaryKey(),
    // `profile`: cast photos (`people.profile_image_id`), no CHECK constraint in SQLite.
    kind: text({ enum: ['poster', 'backdrop', 'logo', 'still', 'profile'] }).notNull(),
    origin: text({ enum: ['tmdb', 'custom'] }).notNull(),
    tmdbPath: text(),
    localPath: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    language: text(),
  },
  (t) => [index('images_tmdb_path_idx').on(t.tmdbPath)],
)

export const items = sqliteTable(
  'items',
  {
    id: text().primaryKey(),
    kind: text({ enum: ['movie', 'series', 'season', 'episode'] }).notNull(),
    parentId: text().references((): AnySQLiteColumn => items.id, { onDelete: 'cascade' }),
    tmdbId: integer(),
    imdbId: text(),
    tvdbId: integer(),
    title: text().notNull(),
    originalTitle: text(),
    sortTitle: text().notNull(),
    year: integer(),
    overview: text(),
    releaseDate: text(),
    runtimeMinutes: integer(),
    genres: text({ mode: 'json' }).$type<unknown>().notNull().default([]),
    originalLanguage: text(),
    voteAverage: real(),
    contentRating: text(),
    /**
     * Country of `content_rating` (§9.1: the library's, or the US fallback); absent = the rating
     * country of the library holding the source (rows enriched before this column).
     */
    contentRatingCountry: text(),
    seriesStatus: text({ enum: ['in_production', 'ended', 'canceled'] }),
    seasonNumber: integer(),
    episodeNumber: integer(),
    airDate: text(),
    episodeCountTmdb: integer(),
    /** Series: TMDB `last_air_date`, the end of "2023 – 2025" (§13.5). */
    lastAirDate: text(),
    posterImageId: text().references(() => images.id, { onDelete: 'set null' }),
    backdropImageId: text().references(() => images.id, { onDelete: 'set null' }),
    logoImageId: text().references(() => images.id, { onDelete: 'set null' }),
    stillImageId: text().references(() => images.id, { onDelete: 'set null' }),
    addedAt: text(),
    metadataRefreshedAt: text(),
    /**
     * Language (BCP 47) the TMDB metadata was last written in (§9.1, §9.4); absent on local items.
     * Compared with the language the item resolves to, it tells the stale rows after a change.
     */
    metadataLanguage: text(),
    createdAt: text().notNull(),
    updatedAt: text().notNull(),
  },
  (t) => [
    index('items_parent_id_idx').on(t.parentId),
    index('items_kind_sort_title_idx').on(t.kind, t.sortTitle),
    index('items_kind_added_at_idx').on(t.kind, t.addedAt),
    index('items_tmdb_id_idx').on(t.kind, t.tmdbId),
  ],
)

export const itemOverrides = sqliteTable(
  'item_overrides',
  {
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    field: text({
      enum: ['title', 'year', 'overview', 'genres', 'poster_image_id', 'backdrop_image_id'],
    }).notNull(),
    value: text({ mode: 'json' }).$type<unknown>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.field] })],
)

/**
 * Memory of the corrections (§7.8, §9.2), keyed by the file and not by its `sources` row: a purged
 * source that comes back (new row, same path or same bytes) gets its correction again.
 * `source_id`: the source it was last applied to (a move the scan recognized keeps its row).
 */
export const manualMatches = sqliteTable(
  'manual_matches',
  {
    libraryId: text()
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    relativePath: text().notNull(),
    signature: text(),
    sourceId: text().references(() => sources.id, { onDelete: 'set null' }),
    tmdbId: integer().notNull(),
    kind: text({ enum: ['movie', 'episode'] }).notNull(),
    seasonNumber: integer(),
    episodeNumber: integer(),
    createdBy: text().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.libraryId, t.relativePath] }),
    index('manual_matches_signature_idx').on(t.signature),
    index('manual_matches_source_id_idx').on(t.sourceId),
  ],
)

export const people = sqliteTable(
  'people',
  {
    id: text().primaryKey(),
    tmdbId: integer().notNull(),
    name: text().notNull(),
    profileImageId: text().references(() => images.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('people_tmdb_id_unique').on(t.tmdbId)],
)

export const itemPeople = sqliteTable(
  'item_people',
  {
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    personId: text()
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    role: text({ enum: ['cast', 'director', 'writer'] }).notNull(),
    character: text(),
    order: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.personId, t.role] }),
    index('item_people_person_id_idx').on(t.personId),
  ],
)
