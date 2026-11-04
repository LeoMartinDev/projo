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

/**
 * §27.3 OAuth clients of the MCP server: a Client ID Metadata Document (`client_id` is its HTTPS
 * URL, re-read after 24 h) or a Dynamic Client Registration (`client_id` generated here).
 */
export const oauthClients = sqliteTable(
  'oauth_clients',
  {
    id: text().primaryKey(),
    clientId: text().notNull(),
    kind: text({ enum: ['cimd', 'dcr'] }).notNull(),
    name: text().notNull(),
    redirectUris: text({ mode: 'json' }).$type<unknown>().notNull(),
    createdAt: text().notNull(),
    fetchedAt: text(),
    lastUsedAt: text(),
  },
  (t) => [uniqueIndex('oauth_clients_client_id_unique').on(t.clientId)],
)

/**
 * §27.3 assistants of the MCP server, the "AI assistants" rows: a token created in the admin
 * (`kind = token`, its hash here), or an OAuth connection (`kind = oauth`, its tokens in
 * `oauth_tokens`). Bound to an admin account and to the profile it acts as, until revoked.
 */
export const assistantTokens = sqliteTable(
  'assistant_tokens',
  {
    id: text().primaryKey(),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text({ enum: ['token', 'oauth'] })
      .notNull()
      .default('token'),
    clientId: text().references(() => oauthClients.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    tokenHash: text(),
    createdAt: text().notNull(),
    lastUsedAt: text(),
    revokedAt: text(),
  },
  (t) => [
    uniqueIndex('assistant_tokens_token_hash_unique').on(t.tokenHash),
    index('assistant_tokens_account_id_idx').on(t.accountId),
  ],
)

/** §27.3 authorization codes: single use, 60 s, bound to the PKCE challenge and redirect URI. */
export const oauthCodes = sqliteTable(
  'oauth_codes',
  {
    codeHash: text().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    accountId: text()
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    redirectUri: text().notNull(),
    codeChallenge: text().notNull(),
    scope: text().notNull(),
    expiresAt: text().notNull(),
    usedAt: text(),
  },
  (t) => [index('oauth_codes_expires_at_idx').on(t.expiresAt)],
)

/**
 * §27.3 access (1 h) and refresh (90 days, rotated) tokens of an OAuth assistant. A rotated
 * refresh token is kept until it expires: presenting it again revokes the assistant.
 */
export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    tokenHash: text().primaryKey(),
    assistantId: text()
      .notNull()
      .references(() => assistantTokens.id, { onDelete: 'cascade' }),
    kind: text({ enum: ['access', 'refresh'] }).notNull(),
    expiresAt: text().notNull(),
    rotatedAt: text(),
  },
  (t) => [
    index('oauth_tokens_assistant_id_idx').on(t.assistantId),
    index('oauth_tokens_expires_at_idx').on(t.expiresAt),
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
