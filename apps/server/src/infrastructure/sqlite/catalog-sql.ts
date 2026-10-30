import { type SQL, sql } from 'drizzle-orm'

import type { VisibilityScope } from '../../core/catalog/catalog.ts'

/**
 * SQL fragments of §6.3 visibility and of the profile scope (§14: library access, maximum
 * content rating), shared by the catalog, progress and watchlist repositories.
 *
 * Plans: every correlated lookup starts from the item (`CROSS JOIN` fixes the join order) and
 * `+x.kind` keeps SQLite off the low-selectivity `(kind, …)` indexes. Without both, SQLite scans
 * every ready source, or every season, for each row (seconds on 20 000 items, §21).
 */

const ref = (alias: string, column: string): SQL => sql.raw(`"${alias}"."${column}"`)

const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )

/**
 * Library access (§14): sources of the listed libraries only. `+library_id`: never drive the query
 * from the library index (every source of the library, seconds on 20,000 items).
 */
export const libraryFilter = (scope: VisibilityScope, sourceAlias = 's'): SQL => {
  if (scope.libraryIds === undefined) return sql``
  if (scope.libraryIds.length === 0) return sql` AND 0`
  return sql` AND +${ref(sourceAlias, 'library_id')} IN (${list(scope.libraryIds)})`
}

/**
 * A content rating and its country (§9.1), as SQL: movies and series carry them; the country is
 * absent on rows enriched before it was stored (the library's then applies).
 */
export type RatingSql = { value: SQL; country: SQL }

/** The rating columns of the row `alias` (a movie or a series). */
export const ratingColumns = (alias: string): RatingSql => ({
  value: ref(alias, 'content_rating'),
  country: ref(alias, 'content_rating_country'),
})

/**
 * Maximum content rating (§14): the item's rating must be allowed in its own rating country,
 * else (unknown country) in the rating country of the source's library; a country without
 * allowed ratings, or an unknown rating, hides it.
 */
export const ratingFilter = (
  scope: VisibilityScope,
  rating: RatingSql,
  libraryAlias = 'l',
): SQL => {
  if (scope.allowedRatings === undefined) return sql``
  const countries = Object.entries(scope.allowedRatings).filter(([, ratings]) => ratings.length > 0)
  if (countries.length === 0) return sql` AND 0`
  const cases = countries.map(
    ([country, ratings]) => sql`WHEN ${country} THEN ${rating.value} IN (${list(ratings)})`,
  )
  return sql` AND coalesce(CASE coalesce(${rating.country}, ${ref(libraryAlias, 'rating_country')}) ${sql.join(cases, sql` `)} ELSE 0 END, 0)`
}

/** Joins `libraries l` on `sources s` when the rating filter needs the rating country. */
const libraryJoin = (scope: VisibilityScope): SQL =>
  scope.allowedRatings === undefined ? sql`` : sql` CROSS JOIN libraries l ON l.id = s.library_id`

const parentColumn = (alias: string, column: string): SQL =>
  sql.raw(`(SELECT rp.${column} FROM items rp WHERE rp.id = "${alias}"."parent_id")`)
const grandParentColumn = (alias: string, column: string): SQL =>
  sql.raw(
    `(SELECT rs.${column} FROM items rp CROSS JOIN items rs ON rs.id = rp.parent_id WHERE rp.id = "${alias}"."parent_id")`,
  )

/** Ratings live on movies and series (§9.1): a season or an episode takes its series'. */
export const seasonRating = (alias: string): RatingSql => ({
  value: parentColumn(alias, 'content_rating'),
  country: parentColumn(alias, 'content_rating_country'),
})
export const episodeRating = (alias: string): RatingSql => ({
  value: grandParentColumn(alias, 'content_rating'),
  country: grandParentColumn(alias, 'content_rating_country'),
})

/** The rating that applies to the row `alias`, whatever its kind. */
export const ratingOf = (alias: string): RatingSql => {
  const season = seasonRating(alias)
  const episode = episodeRating(alias)
  const own = ratingColumns(alias)
  const pick = (key: keyof RatingSql) => sql`(CASE ${ref(alias, 'kind')}
  WHEN 'episode' THEN ${episode[key]}
  WHEN 'season' THEN ${season[key]}
  ELSE ${own[key]} END)`
  return { value: pick('value'), country: pick('country') }
}

/** A ready source of `itemId` in the scope; `rating` is the item's (only read with a cap). */
export const hasReadySource = (itemId: SQL, scope: VisibilityScope, rating: RatingSql): SQL =>
  sql`EXISTS (SELECT 1 FROM source_items si CROSS JOIN sources s ON s.id = si.source_id${libraryJoin(scope)} WHERE si.item_id = ${itemId} AND s.state = 'ready'${libraryFilter(scope)}${ratingFilter(scope, rating)})`

/** A visible episode `alias` (§6.3 + scope). */
export const episodeVisible = (alias: string, scope: VisibilityScope): SQL =>
  hasReadySource(ref(alias, 'id'), scope, episodeRating(alias))

/** The visible episodes of the series `seriesAlias`: `FROM … WHERE …` with `se`, `e`. */
export const visibleEpisodesOfSeries = (seriesAlias: string, scope: VisibilityScope): SQL =>
  sql`items se CROSS JOIN items e ON e.parent_id = se.id WHERE se.parent_id = ${ref(seriesAlias, 'id')} AND +se.kind = 'season' AND +e.kind = 'episode' AND ${hasReadySource(sql`e.id`, scope, ratingColumns(seriesAlias))}`

/** §6.3 visibility of the row `alias` (any kind), within the scope. */
export const visibleAs = (alias: string, scope: VisibilityScope): SQL => {
  const id = ref(alias, 'id')
  return sql`(CASE ${ref(alias, 'kind')}
  WHEN 'movie' THEN ${hasReadySource(id, scope, ratingColumns(alias))}
  WHEN 'episode' THEN ${episodeVisible(alias, scope)}
  WHEN 'season' THEN EXISTS (SELECT 1 FROM items e WHERE e.parent_id = ${id} AND +e.kind = 'episode' AND ${hasReadySource(sql`e.id`, scope, seasonRating(alias))})
  WHEN 'series' THEN EXISTS (SELECT 1 FROM ${visibleEpisodesOfSeries(alias, scope)})
  ELSE 0 END)`
}

/** Visibility of the row of the `items` table of the outer query. */
export const visible = (scope: VisibilityScope): SQL => visibleAs('items', scope)

/**
 * A source row (`sourcesAlias`, joined with its library `librariesAlias`) usable for an item
 * whose rating is `rating`: ready, in the scope.
 */
export const readySourceIn = (
  scope: VisibilityScope,
  rating: RatingSql,
  aliases: { sources: string; libraries: string } = { sources: 'sources', libraries: 'libraries' },
): SQL =>
  // `+state`: never drive the query from the `state` index (every ready source of the library).
  sql`+${ref(aliases.sources, 'state')} = 'ready'${libraryFilter(scope, aliases.sources)}${ratingFilter(scope, rating, aliases.libraries)}`

/** The rating of the item `itemId` (a parameter), for source filters. */
export const ratingOfItemId = (itemId: SQL): RatingSql => {
  const rating = ratingOf('ri')
  return {
    value: sql`(SELECT ${rating.value} FROM items ri WHERE ri.id = ${itemId})`,
    country: sql`(SELECT ${rating.country} FROM items ri WHERE ri.id = ${itemId})`,
  }
}
