import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import { type HomeCategoryDto, homeCategorySlug, recentlyAddedTarget } from '@projo/shared/api/home'

import type { SeeAll } from './Row.tsx'

export const recentlyAddedSeeAll = (items: readonly ItemSummaryDto[]): SeeAll => ({
  to: recentlyAddedTarget(items) === 'series' ? '/series' : '/movies',
  sort: 'added',
})

export const categorySeeAll = (category: HomeCategoryDto): SeeAll => ({
  to: '/categories/$category',
  category: homeCategorySlug(category),
})
