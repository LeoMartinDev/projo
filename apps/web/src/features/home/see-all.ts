import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import { type HomeCategoryDto, homeCategorySlug } from '@projo/shared/api/home'

import type { SeeAll } from './Row.tsx'

/** "See all ›" of Recently added: Movies, or Shows when most of its titles are series. */
export const recentlyAddedSeeAll = (items: readonly ItemSummaryDto[]): SeeAll => ({
  to:
    items.filter((item) => item.kind === 'series').length > items.length / 2
      ? '/series'
      : '/movies',
  sort: 'added',
})

/** "See all ›" of a category row: the category page (§13.3), Anime included. */
export const categorySeeAll = (category: HomeCategoryDto): SeeAll => ({
  to: '/categories/$category',
  category: homeCategorySlug(category),
})
