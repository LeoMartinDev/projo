import { type SQL, sql } from 'drizzle-orm'

import type { VisibilityScope } from '../../core/catalog/catalog.ts'

const ref = (alias: string, column: string): SQL => sql.raw(`"${alias}"."${column}"`)

const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )

export const libraryFilter = (scope: VisibilityScope, sourceAlias = 's'): SQL => {
  if (scope.libraryIds === undefined) return sql``
  if (scope.libraryIds.length === 0) return sql` AND 0`
  return sql` AND +${ref(sourceAlias, 'library_id')} IN (${list(scope.libraryIds)})`
}

export type RatingSql = { value: SQL; country: SQL }

export const ratingColumns = (alias: string): RatingSql => ({
  value: ref(alias, 'content_rating'),
  country: ref(alias, 'content_rating_country'),
})

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

const libraryJoin = (scope: VisibilityScope): SQL =>
  scope.allowedRatings === undefined ? sql`` : sql` CROSS JOIN libraries l ON l.id = s.library_id`

const parentColumn = (alias: string, column: string): SQL =>
  sql.raw(`(SELECT rp.${column} FROM items rp WHERE rp.id = "${alias}"."parent_id")`)
const grandParentColumn = (alias: string, column: string): SQL =>
  sql.raw(
    `(SELECT rs.${column} FROM items rp CROSS JOIN items rs ON rs.id = rp.parent_id WHERE rp.id = "${alias}"."parent_id")`,
  )

export const seasonRating = (alias: string): RatingSql => ({
  value: parentColumn(alias, 'content_rating'),
  country: parentColumn(alias, 'content_rating_country'),
})
export const episodeRating = (alias: string): RatingSql => ({
  value: grandParentColumn(alias, 'content_rating'),
  country: grandParentColumn(alias, 'content_rating_country'),
})

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

export const hasReadySource = (itemId: SQL, scope: VisibilityScope, rating: RatingSql): SQL =>
  sql`EXISTS (SELECT 1 FROM source_items si CROSS JOIN sources s ON s.id = si.source_id${libraryJoin(scope)} WHERE si.item_id = ${itemId} AND s.state = 'ready'${libraryFilter(scope)}${ratingFilter(scope, rating)})`

export const episodeVisible = (alias: string, scope: VisibilityScope): SQL =>
  hasReadySource(ref(alias, 'id'), scope, episodeRating(alias))

export const visibleEpisodesOfSeries = (seriesAlias: string, scope: VisibilityScope): SQL =>
  sql`items se CROSS JOIN items e ON e.parent_id = se.id WHERE se.parent_id = ${ref(seriesAlias, 'id')} AND +se.kind = 'season' AND +e.kind = 'episode' AND ${hasReadySource(sql`e.id`, scope, ratingColumns(seriesAlias))}`

export const visibleAs = (alias: string, scope: VisibilityScope): SQL => {
  const id = ref(alias, 'id')
  return sql`(CASE ${ref(alias, 'kind')}
  WHEN 'movie' THEN ${hasReadySource(id, scope, ratingColumns(alias))}
  WHEN 'episode' THEN ${episodeVisible(alias, scope)}
  WHEN 'season' THEN EXISTS (SELECT 1 FROM items e WHERE e.parent_id = ${id} AND +e.kind = 'episode' AND ${hasReadySource(sql`e.id`, scope, seasonRating(alias))})
  WHEN 'series' THEN EXISTS (SELECT 1 FROM ${visibleEpisodesOfSeries(alias, scope)})
  ELSE 0 END)`
}

export const visible = (scope: VisibilityScope): SQL => visibleAs('items', scope)

export const readySourceIn = (
  scope: VisibilityScope,
  rating: RatingSql,
  aliases: { sources: string; libraries: string } = { sources: 'sources', libraries: 'libraries' },
): SQL =>
  sql`+${ref(aliases.sources, 'state')} = 'ready'${libraryFilter(scope, aliases.sources)}${ratingFilter(scope, rating, aliases.libraries)}`

export const ratingOfItemId = (itemId: SQL): RatingSql => {
  const rating = ratingOf('ri')
  return {
    value: sql`(SELECT ${rating.value} FROM items ri WHERE ri.id = ${itemId})`,
    country: sql`(SELECT ${rating.country} FROM items ri WHERE ri.id = ${itemId})`,
  }
}
