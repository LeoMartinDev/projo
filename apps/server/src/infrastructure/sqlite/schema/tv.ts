import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { profiles } from './accounts.ts'

/** A TV source (§29.2): one subscription of one kind; `settings` hold its secrets in clear. */
export const tvSources = sqliteTable('tv_sources', {
  id: text().primaryKey(),
  kind: text({ enum: ['m3u', 'xtream', 'freebox'] }).notNull(),
  name: text().notNull(),
  settings: text({ mode: 'json' }).$type<unknown>().notNull(),
  maxConnections: integer(),
  /** Guide location found by the last refresh (an M3U header's `url-tvg`), §29.3. */
  discoveredGuideUrl: text(),
  createdAt: text().notNull(),
  lastAttemptAt: text(),
  lastRefreshAt: text(),
  lastError: text({ mode: 'json' }).$type<unknown>(),
  failureCount: integer().notNull().default(0),
  /** Last `refresh_tv_guide` attempt: the hourly task reads guides 6 hours old (§29.3). */
  guideAttemptAt: text(),
})

/** A group of a source's channels, matched by name; `name` is empty for the unnamed group. */
export const tvGroups = sqliteTable(
  'tv_groups',
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => tvSources.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    enabled: integer({ mode: 'boolean' }).notNull().default(false),
    position: integer().notNull(),
  },
  (t) => [uniqueIndex('tv_groups_source_name_idx').on(t.sourceId, t.name)],
)

export const tvChannels = sqliteTable(
  'tv_channels',
  {
    id: text().primaryKey(),
    sourceId: text()
      .notNull()
      .references(() => tvSources.id, { onDelete: 'cascade' }),
    /** Identity across refreshes, derived by the source's connector (§29.2). */
    key: text().notNull(),
    name: text().notNull(),
    /** `name` lowercased without accents, for the admin's search. */
    searchName: text().notNull(),
    number: integer(),
    groupId: text()
      .notNull()
      .references(() => tvGroups.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    /** `{ url, userAgent?, referrer? }`: never leaves the server. */
    upstream: text({ mode: 'json' }).$type<unknown>().notNull(),
    guideKey: text(),
    logoUrl: text(),
    /** Relative to the images directory (`tv/<id>.<ext>`). */
    logoPath: text(),
    /** URL of the last download attempt, and when the file at `logoPath` was fetched. */
    logoFetchedUrl: text(),
    logoFetchedAt: text(),
    /** Set while the last attempt failed: tried again a day later (§29.2). */
    logoFailedAt: text(),
    enabled: integer({ mode: 'boolean' }).notNull().default(false),
    missingSince: text(),
    /** Cached probe of the channel's stream (§29.4). */
    probe: text({ mode: 'json' }).$type<unknown>(),
    probedAt: text(),
    createdAt: text().notNull(),
  },
  (t) => [
    uniqueIndex('tv_channels_source_key_idx').on(t.sourceId, t.key),
    index('tv_channels_source_position_idx').on(t.sourceId, t.position),
    index('tv_channels_group_idx').on(t.groupId),
    index('tv_channels_enabled_idx').on(t.enabled, t.missingSince),
  ],
)

export const tvProgrammes = sqliteTable(
  'tv_programmes',
  {
    id: text().primaryKey(),
    channelId: text()
      .notNull()
      .references(() => tvChannels.id, { onDelete: 'cascade' }),
    startAt: text().notNull(),
    endAt: text().notNull(),
    title: text().notNull(),
    subtitle: text(),
    description: text(),
    category: text(),
  },
  (t) => [index('tv_programmes_channel_end_idx').on(t.channelId, t.endAt)],
)

export const tvFavorites = sqliteTable(
  'tv_favorites',
  {
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    channelId: text()
      .notNull()
      .references(() => tvChannels.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    createdAt: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.channelId] }),
    index('tv_favorites_channel_idx').on(t.channelId),
  ],
)
