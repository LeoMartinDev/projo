import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { libraries } from './libraries.ts'

// §6.1 Comptes et profils

export const accounts = sqliteTable(
  'accounts',
  {
    id: text().primaryKey(),
    username: text().notNull(),
    passwordHash: text().notNull(),
    role: text({ enum: ['admin', 'user'] }).notNull(),
    createdAt: text().notNull(),
    disabledAt: text(),
  },
  (t) => [uniqueIndex('accounts_username_ci_unique').on(sql`lower(${t.username})`)],
)

export const invitations = sqliteTable(
  'invitations',
  {
    id: text().primaryKey(),
    tokenHash: text().notNull(),
    /** Absent once the admin who created it is deleted: the history stays (§14). */
    createdBy: text().references(() => accounts.id, { onDelete: 'set null' }),
    expiresAt: text().notNull(),
    usedAt: text(),
    usedByAccountId: text().references(() => accounts.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('invitations_token_hash_unique').on(t.tokenHash)],
)

export const profiles = sqliteTable(
  'profiles',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    avatarColor: text({
      enum: ['slate', 'blue', 'honey', 'sage', 'terracotta', 'violet'],
    }).notNull(),
    pinHash: text(),
    maxContentRating: text(),
    libraryAccess: text({ enum: ['all', 'selected'] })
      .notNull()
      .default('all'),
    uiLocale: text({ enum: ['fr', 'en'] })
      .notNull()
      .default('fr'),
    audioLanguage: text().notNull(),
    subtitleLanguage: text().notNull(),
    subtitleMode: text({ enum: ['never', 'always', 'when_audio_differs', 'forced_only'] })
      .notNull()
      .default('when_audio_differs'),
    animeOriginalAudio: integer({ mode: 'boolean' }).notNull().default(false),
    autoplayNext: integer({ mode: 'boolean' }).notNull().default(true),
    autoSkipIntro: integer({ mode: 'boolean' }).notNull().default(false),
    autoSkipCredits: integer({ mode: 'boolean' }).notNull().default(false),
    createdAt: text().notNull(),
  },
  (t) => [index('profiles_account_id_idx').on(t.accountId)],
)

export const profileLibraries = sqliteTable(
  'profile_libraries',
  {
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    libraryId: text()
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.libraryId] })],
)

export const sessions = sqliteTable(
  'sessions',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: text({ enum: ['cookie', 'bearer'] }).notNull(),
    tokenHash: text().notNull(),
    deviceName: text().notNull(),
    userAgent: text().notNull(),
    lastProfileId: text().references(() => profiles.id, { onDelete: 'set null' }),
    createdAt: text().notNull(),
    lastSeenAt: text().notNull(),
    expiresAt: text().notNull(),
    revokedAt: text(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_account_id_idx').on(t.accountId),
  ],
)

/** §14 "Pairing a device": a code shown by the web, claimed by the app. Only its hash is kept. */
export const pairings = sqliteTable(
  'pairings',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    createdBySessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    codeHash: text().notNull(),
    createdAt: text().notNull(),
    expiresAt: text().notNull(),
    claimedAt: text(),
    claimedSessionId: text().references(() => sessions.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('pairings_code_hash_idx').on(t.codeHash),
    index('pairings_account_id_idx').on(t.accountId),
  ],
)
