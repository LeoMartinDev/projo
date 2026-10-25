import type { CatalogRepository, VisibilityScope } from '../../core/catalog/catalog.ts'
import {
  categoryBatch,
  categoryKey,
  categoryRows,
  countCategories,
  type HomeCategory,
  type HomeCategoryQueries,
  selectCategories,
  seriesWithWatchedEpisodes,
  watchedTitles,
} from '../../core/home/categories.ts'
import type { ProgressQueries } from '../../core/progress/rows.ts'
import type { CatalogEntries, CatalogEntry } from '../catalog/catalog-entries.ts'

export type HomeCategoryRow = { category: HomeCategory; entries: CatalogEntry[] }

export type HomeCategoriesView = {
  rows: HomeCategoryRow[]
  /** Rows of the whole list. */
  total: number
  /** Offset of the next batch; absent after the last one. */
  nextOffset?: number
}

type Deps = {
  categoryQueries: HomeCategoryQueries
  catalogRepository: Pick<CatalogRepository, 'findManyVisible' | 'listSeriesEpisodes'>
  progressQueries: ProgressQueries
  catalogEntries: CatalogEntries
}

/**
 * `GET /home/categories` (§13.3 item 6): the batch of category rows at `offset`, for the active
 * profile and its scope. Fixed number of queries per batch: the visible titles with their genres
 * (the category list and the rows), the watched titles, then the cards of the batch. Each batch
 * recomputes the list: a cursor is an offset in it.
 */
export const getHomeCategoriesFactory =
  ({ categoryQueries, catalogRepository, progressQueries, catalogEntries }: Deps) =>
  async ({
    profileId,
    scope,
    offset,
  }: {
    profileId: string
    scope: VisibilityScope
    offset: number
  }): Promise<HomeCategoriesView> => {
    const titles = categoryQueries.listTitles({ scope })
    const categories = selectCategories(countCategories(titles))
    const { batch, nextOffset } = categoryBatch(categories, offset)
    const page = (rows: HomeCategoryRow[]): HomeCategoriesView => ({
      rows,
      total: categories.length,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    })
    if (batch.length === 0) return page([])

    // Watched last (§13.1): movies watched, series whose every visible episode is.
    const played = progressQueries.listPlayed({ profileId, scope })
    const seriesIds = seriesWithWatchedEpisodes(played)
    const watched = watchedTitles({
      played,
      episodes:
        seriesIds.length === 0 ? [] : catalogRepository.listSeriesEpisodes({ seriesIds, scope }),
    })
    const ids = categoryRows({ titles, categories: batch, watched })
    const items = catalogRepository.findManyVisible({ ids: [...ids.values()].flat(), scope })
    const entries = new Map(
      catalogEntries({ profileId, items, scope }).map((entry) => [entry.item.id, entry]),
    )
    return page(
      batch.flatMap((category): HomeCategoryRow[] => {
        const row = (ids.get(categoryKey(category)) ?? []).flatMap((id) => entries.get(id) ?? [])
        return row.length === 0 ? [] : [{ category, entries: row }]
      }),
    )
  }

export type GetHomeCategories = ReturnType<typeof getHomeCategoriesFactory>
