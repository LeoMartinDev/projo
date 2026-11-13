import type { VisibilityScope } from '../../core/catalog/catalog.ts'
import { categoryKey, categoryRows, type HomeCategory } from '../../core/home/categories.ts'
import type { CatalogEntry } from '../catalog/shared/catalog-entries.ts'
import { type HomeCategoryDeps, watchedTitlesFor } from './shared/watched-titles.ts'

export type HomeCategoryPageView = {
  entries: CatalogEntry[]
  nextOffset?: number
}

export const getHomeCategoryPageFactory =
  ({ categoryQueries, catalogReadModel, progressQueries, catalogEntries }: HomeCategoryDeps) =>
  async ({
    profileId,
    scope,
    category,
    offset,
    limit,
  }: {
    profileId: string
    scope: VisibilityScope
    category: HomeCategory
    offset: number
    limit: number
  }): Promise<HomeCategoryPageView> => {
    const watched = watchedTitlesFor({ catalogReadModel, progressQueries })({ profileId, scope })
    const ids =
      categoryRows({
        titles: categoryQueries.listTitles({ scope }),
        categories: [category],
        watched,
        limit: Number.POSITIVE_INFINITY,
      }).get(categoryKey(category)) ?? []
    const page = ids.slice(offset, offset + limit)
    const next = offset + limit
    const more = next < ids.length ? { nextOffset: next } : {}
    if (page.length === 0) return { entries: [], ...more }

    const items = catalogReadModel.findManyVisible({ ids: page, scope })
    const entries = new Map(
      catalogEntries({ profileId, items, scope }).map((entry) => [entry.item.id, entry]),
    )
    return { entries: page.flatMap((id) => entries.get(id) ?? []), ...more }
  }

export type GetHomeCategoryPage = ReturnType<typeof getHomeCategoryPageFactory>
