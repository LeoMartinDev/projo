import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// §9.2: TMDB responses cached in the database (series, seasons, movies), by request key
// (`tv/1396?language=fr-FR`). Raw validated JSON, re-validated when read.
export const tmdbResponses = sqliteTable(
  'tmdb_responses',
  {
    key: text().primaryKey(),
    payload: text({ mode: 'json' }).$type<unknown>().notNull(),
    fetchedAt: text().notNull(),
  },
  (t) => [index('tmdb_responses_fetched_at_idx').on(t.fetchedAt)],
)
