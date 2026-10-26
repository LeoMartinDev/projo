import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { items } from './items.ts'

// §6.2 Librairies et sources

export const libraries = sqliteTable('libraries', {
  id: text().primaryKey(),
  name: text().notNull(),
  hint: text({ enum: ['auto', 'movies', 'series'] })
    .notNull()
    .default('auto'),
  scanIntervalMinutes: integer().notNull().default(15),
  watchEnabled: integer({ mode: 'boolean' }).notNull().default(true),
  quietPeriodSeconds: integer().notNull().default(120),
  detectSegments: integer({ mode: 'boolean' }).notNull().default(true),
  preExtractSubtitles: integer({ mode: 'boolean' }).notNull().default(false),
  trickplayEnabled: integer({ mode: 'boolean' }).notNull().default(true),
  metadataLanguage: text(),
  ratingCountry: text().notNull().default('FR'),
  createdAt: text().notNull(),
})

export const libraryRoots = sqliteTable(
  'library_roots',
  {
    id: text().primaryKey(),
    libraryId: text()
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    path: text().notNull(),
    state: text({ enum: ['ok', 'unreachable'] })
      .notNull()
      .default('ok'),
    lastScanAt: text(),
    lastFileCount: integer().notNull().default(0),
    /** `rootErrorReasons` of `@projo/shared/api/libraries`; rows of older versions: English text. */
    lastError: text({ enum: ['not_found', 'not_directory', 'io_error', 'empty', 'no_media'] }),
  },
  (t) => [
    index('library_roots_library_id_idx').on(t.libraryId),
    uniqueIndex('library_roots_path_unique').on(t.path),
  ],
)

export const sources = sqliteTable(
  'sources',
  {
    id: text().primaryKey(),
    libraryId: text()
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    rootId: text()
      .notNull()
      .references(() => libraryRoots.id, { onDelete: 'cascade' }),
    relativePath: text().notNull(),
    extension: text().notNull(),
    state: text({ enum: ['pending', 'ready', 'missing', 'rejected'] }).notNull(),
    pendingReason: text({ enum: ['growing', 'probe_failed', 'decode_failed', 'too_small'] }),
    sizeBytes: integer().notNull(),
    // fs.Stats#mtimeMs as-is (fractional ms): compared for strict equality by the stability check.
    mtime: real().notNull(),
    inode: text(),
    discoveredAt: text().notNull(),
    // Since when the source is pending (24 h stuck notification, §7.3 step 5).
    pendingSince: text(),
    // Since when (size, mtime) has been observed unchanged: the quiet-period counter (§7.3 step 3).
    unchangedSince: text(),
    stableSince: text(),
    readyAt: text(),
    missingSince: text(),
    probe: text({ mode: 'json' }).$type<unknown>(),
    signature: text(),
    classification: text({ enum: ['movie', 'episode', 'unknown'] })
      .notNull()
      .default('unknown'),
    parsed: text({ mode: 'json' }).$type<unknown>().notNull().default({}),
    matchState: text({ enum: ['unmatched', 'matched', 'manual', 'needs_review'] })
      .notNull()
      .default('unmatched'),
    reviewReason: text({
      enum: [
        'classification_ambiguous',
        'no_match',
        'ambiguous_match',
        'episode_not_found',
        'absolute_numbering',
        'date_based',
        'hint_conflict',
        'no_episode_number',
      ],
    }),
    versionLabel: text(),
    stackGroupId: text(),
    partIndex: integer(),
  },
  (t) => [
    uniqueIndex('sources_root_path_unique').on(t.rootId, t.relativePath),
    index('sources_library_state_idx').on(t.libraryId, t.state),
    index('sources_state_idx').on(t.state),
    index('sources_stack_group_idx').on(t.stackGroupId),
  ],
)

export const sourceItems = sqliteTable(
  'source_items',
  {
    sourceId: text()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.itemId] }),
    index('source_items_item_id_idx').on(t.itemId),
  ],
)

export const sourceSubtitles = sqliteTable(
  'source_subtitles',
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    kind: text({ enum: ['external', 'embedded'] }).notNull(),
    path: text(),
    streamIndex: integer(),
    language: text(),
    forced: integer({ mode: 'boolean' }).notNull().default(false),
    sdh: integer({ mode: 'boolean' }).notNull().default(false),
    isDefault: integer({ mode: 'boolean' }).notNull().default(false),
    format: text().notNull(),
    title: text(),
  },
  (t) => [index('source_subtitles_source_id_idx').on(t.sourceId)],
)

export const scanRuns = sqliteTable(
  'scan_runs',
  {
    id: text().primaryKey(),
    libraryId: text()
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    kind: text({
      enum: [
        'watch',
        'periodic',
        'manual_quick',
        'manual_full',
        'startup',
        'initial',
        'rules_update',
      ],
    }).notNull(),
    startedAt: text().notNull(),
    finishedAt: text(),
    stats: text({ mode: 'json' }).$type<unknown>().notNull().default({}),
    error: text(),
  },
  (t) => [index('scan_runs_library_started_idx').on(t.libraryId, t.startedAt)],
)
