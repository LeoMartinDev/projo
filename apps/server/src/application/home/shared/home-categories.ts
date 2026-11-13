import type { CatalogReadModel, VisibilityScope } from '../../../core/catalog/catalog.ts'
import {
  type HomeCategoryQueries,
  seriesWithWatchedEpisodes,
  watchedTitles,
} from '../../../core/home/categories.ts'
import type { ProgressQueries } from '../../../core/progress/rows.ts'
import type { CatalogEntries } from '../../catalog/shared/catalog-entries.ts'

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
