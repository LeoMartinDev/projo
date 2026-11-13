import type { CatalogReadModel, VisibilityScope } from '../../core/catalog/catalog.ts'
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
  total: number
  nextOffset?: number
}

export type HomeCategoryDeps = {
  categoryQueries: HomeCategoryQueries
  catalogReadModel: Pick<CatalogReadModel, 'findManyVisible' | 'listSeriesEpisodes'>
  progressQueries: ProgressQueries
  catalogEntries: CatalogEntries
}

export const watchedTitlesFor =
  ({
    catalogReadModel,
    progressQueries,
  }: Pick<HomeCategoryDeps, 'catalogReadModel' | 'progressQueries'>) =>
  ({ profileId, scope }: { profileId: string; scope: VisibilityScope }): Set<string> => {
    const played = progressQueries.listPlayed({ profileId, scope })
    const seriesIds = seriesWithWatchedEpisodes(played)
    return watchedTitles({
      played,
      episodes:
        seriesIds.length === 0 ? [] : catalogReadModel.listSeriesEpisodes({ seriesIds, scope }),
    })
  }

export const getHomeCategoriesFactory =
  ({ categoryQueries, catalogReadModel, progressQueries, catalogEntries }: HomeCategoryDeps) =>
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

    const watched = watchedTitlesFor({ catalogReadModel, progressQueries })({ profileId, scope })
    const ids = categoryRows({ titles, categories: batch, watched })
    const items = catalogReadModel.findManyVisible({ ids: [...ids.values()].flat(), scope })
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
