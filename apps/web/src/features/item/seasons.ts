import type { ItemSummaryDto } from '@projo/shared/api/catalog'

export const bySeason = (a: ItemSummaryDto, b: ItemSummaryDto) =>
  (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)

export const selectedSeasonOf = (
  seasons: readonly ItemSummaryDto[],
  wanted: number | undefined,
): ItemSummaryDto | undefined =>
  seasons.find((item) => item.seasonNumber === wanted) ??
  seasons.find((item) => (item.seasonNumber ?? 0) > 0) ??
  seasons[0]
