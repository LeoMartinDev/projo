import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { profiles, sessions } from './accounts.ts'
import { items } from './items.ts'
import { sources } from './libraries.ts'

export const playbackProgress = sqliteTable(
  'playback_progress',
  {
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    positionMs: integer().notNull().default(0),
    durationMs: integer().notNull().default(0),
    watched: integer({ mode: 'boolean' }).notNull().default(false),
    watchedAt: text(),
    playCount: integer().notNull().default(0),
    lastPlayedAt: text().notNull(),
    hiddenFromContinue: integer({ mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.itemId] }),
    index('playback_progress_profile_last_played_idx').on(t.profileId, t.lastPlayedAt),
  ],
)

export const watchlist = sqliteTable(
  'watchlist',
  {
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    addedAt: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.itemId] })],
)

export const trackPreferences = sqliteTable(
  'track_preferences',
  {
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    audioLanguage: text(),
    subtitleLanguage: text(),
    subtitlesEnabled: integer({ mode: 'boolean' }).notNull().default(false),
    updatedAt: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.itemId] })],
)

export const playbackSessions = sqliteTable(
  'playback_sessions',
  {
    id: text().primaryKey(),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    sourceId: text()
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    mode: text({ enum: ['direct', 'hls_remux', 'hls_transcode'] }).notNull(),
    quality: text(),
    audioStream: integer(),
    subtitleStream: integer(),
    subtitleTrackId: text(),
    burnIn: integer({ mode: 'boolean' }).notNull().default(false),
    audioDelivery: text({ enum: ['copy', 'aac'] }),
    streamSecretHash: text(),
    startedAt: text().notNull(),
    lastHeartbeatAt: text().notNull(),
    positionMs: integer().notNull().default(0),
    endedAt: text(),
  },
  (t) => [
    index('playback_sessions_session_id_idx').on(t.sessionId),
    index('playback_sessions_ended_at_idx').on(t.endedAt),
  ],
)

export const segments = sqliteTable(
  'segments',
  {
    id: text().primaryKey(),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    type: text({ enum: ['intro', 'recap', 'credits', 'preview'] }).notNull(),
    startMs: integer().notNull(),
    endMs: integer().notNull(),
    origin: text({
      enum: ['manual', 'chapter', 'theintrodb', 'introdb', 'skipdb', 'fingerprint'],
    }).notNull(),
    confidence: real(),
    createdAt: text().notNull(),
  },
  (t) => [uniqueIndex('segments_item_type_idx').on(t.itemId, t.type)],
)

export const segmentLookups = sqliteTable(
  'segment_lookups',
  {
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    checkedAt: text().notNull(),
    outcome: text({ enum: ['found', 'none', 'no_segment', 'error'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.provider] })],
)

export const segmentSubmissions = sqliteTable(
  'segment_submissions',
  {
    id: text().primaryKey(),
    itemId: text()
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    type: text({ enum: ['intro', 'recap', 'credits', 'preview'] }).notNull(),
    provider: text({ enum: ['theintrodb', 'skipdb'] }).notNull(),
    startMs: integer().notNull(),
    endMs: integer().notNull(),
    outcome: text({ enum: ['submitted', 'failed'] }).notNull(),
    error: text(),
    submittedAt: text().notNull(),
  },
  (t) => [index('segment_submissions_item_idx').on(t.itemId, t.type, t.provider)],
)
