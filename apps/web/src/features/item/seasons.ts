import type { ItemSummaryDto } from '@projo/shared/api/catalog'

export const bySeason = (a: ItemSummaryDto, b: ItemSummaryDto) =>
  (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)

/**
 * The season tab of a series page, among its seasons sorted by number: the asked one (`?season=`,
 * else the season of the episode to play), else the first regular season, else the specials.
 */
export const selectedSeasonOf = (
  seasons: readonly ItemSummaryDto[],
  wanted: number | undefined,
): ItemSummaryDto | undefined =>
  seasons.find((item) => item.seasonNumber === wanted) ??
  seasons.find((item) => (item.seasonNumber ?? 0) > 0) ??
  seasons[0]
