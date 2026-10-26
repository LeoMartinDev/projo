import type { VisibilityScope } from '../../core/catalog/catalog.ts'
import { categoryKey, categoryRows, type HomeCategory } from '../../core/home/categories.ts'
import type { CatalogEntry } from '../catalog/catalog-entries.ts'
import { type HomeCategoryDeps, watchedTitlesFor } from './get-home-categories.ts'

export type HomeCategoryPageView = {
  entries: CatalogEntry[]
  /** Offset of the next page; absent after the last one. */
  nextOffset?: number
}

/**
 * `GET /home/categories/:category` (§13.3 category page): the page at `offset` of every title of
 * the category visible to the profile, in the order of its row (newest first, the watched ones
 * last), without the row's limit. Like the batches of rows, each page recomputes the list: a
 * cursor is an offset in it.
 */
export const getHomeCategoryPageFactory =
  ({ categoryQueries, catalogRepository, progressQueries, catalogEntries }: HomeCategoryDeps) =>
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
    const watched = watchedTitlesFor({ catalogRepository, progressQueries })({ profileId, scope })
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

    const items = catalogRepository.findManyVisible({ ids: page, scope })
    const entries = new Map(
      catalogEntries({ profileId, items, scope }).map((entry) => [entry.item.id, entry]),
    )
    return { entries: page.flatMap((id) => entries.get(id) ?? []), ...more }
  }

export type GetHomeCategoryPage = ReturnType<typeof getHomeCategoryPageFactory>
