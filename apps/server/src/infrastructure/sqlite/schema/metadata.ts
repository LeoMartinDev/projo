import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const tmdbResponses = sqliteTable(
  'tmdb_responses',
  {
    key: text().primaryKey(),
    payload: text({ mode: 'json' }).$type<unknown>().notNull(),
    fetchedAt: text().notNull(),
  },
  (t) => [index('tmdb_responses_fetched_at_idx').on(t.fetchedAt)],
)
