import type {
  CatalogItem,
  CatalogReadModel,
  VisibilityScope,
} from '../../../core/catalog/catalog.ts'
import type { ProgressRepository } from '../../../core/progress/progress.ts'
import { seriesPlayTarget } from '../../../core/progress/rows.ts'

export type PlayButton = { action: 'resume' | 'play'; item: CatalogItem; positionMs: number }

type Deps = {
  catalogReadModel: Pick<CatalogReadModel, 'findVisible' | 'listSeriesEpisodes'>
  progressRepository: ProgressRepository
}

export type SeriesPlay = (input: {
  profileId: string
  seriesId: string
  seasonNumber?: number
  scope: VisibilityScope
}) => PlayButton | undefined

export const seriesPlayFactory =
  ({ catalogReadModel, progressRepository }: Deps): SeriesPlay =>
  ({ profileId, seriesId, seasonNumber, scope }) => {
    const episodes = catalogReadModel
      .listSeriesEpisodes({ seriesIds: [seriesId], scope })
      .filter((episode) => seasonNumber === undefined || episode.seasonNumber === seasonNumber)
    const progress = progressRepository.findMany({
      profileId,
      itemIds: episodes.map((episode) => episode.id),
    })
    const target = seriesPlayTarget(episodes, progress)
    const item =
      target === undefined
        ? undefined
        : catalogReadModel.findVisible({ id: target.episode.id, scope })
    return target === undefined || item === undefined
      ? undefined
      : { action: target.action, item, positionMs: target.positionMs }
  }
