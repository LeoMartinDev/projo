import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { HomeCategoryDto } from '@projo/shared/api/home'

import type { SeeAll } from './Row.tsx'

/** Movies, or Shows when most of the row's titles are series (§13.3). */
const majorityOf = (items: readonly ItemSummaryDto[]): '/movies' | '/series' =>
  items.filter((item) => item.kind === 'series').length > items.length / 2 ? '/series' : '/movies'

/** "See all ›" of Recently added: the majority type sorted by addition. */
export const recentlyAddedSeeAll = (items: readonly ItemSummaryDto[]): SeeAll => ({
  to: majorityOf(items),
  sort: 'added',
})

/**
 * "See all ›" of a category row: the majority type filtered on the genre, sorted by addition.
 * None for "Anime": no catalog filter says anime (Animation is not Anime).
 */
export const categorySeeAll = (
  category: HomeCategoryDto,
  items: readonly ItemSummaryDto[],
): SeeAll | undefined =>
  category.kind === 'anime'
    ? undefined
    : { to: majorityOf(items), sort: 'added', genre: category.genre }
