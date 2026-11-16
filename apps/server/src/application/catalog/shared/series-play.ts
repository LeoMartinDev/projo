import type {
  CatalogItem,
  CatalogReadModel,
  VisibilityScope,
} from '../../../core/catalog/catalog.ts'
import type { ProgressRepository } from '../../../core/progress/progress.ts'
import { seriesPlayTarget } from '../../../core/progress/rows.ts'

export type PlayButton = {
  action: 'resume' | 'play'
  item: CatalogItem
  positionMs: number
  durationMs?: number
}

/** The duration `positionMs` is relative to: the one recorded with the progress, else the item's. */
export const playDurationMs = (
  item: CatalogItem,
  progress: { durationMs: number } | undefined,
): number | undefined =>
  progress !== undefined && progress.durationMs > 0 ? progress.durationMs : item.durationMs

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
    if (target === undefined || item === undefined) return undefined
    const durationMs = playDurationMs(
      item,
      target.action === 'resume' ? progress.get(item.id) : undefined,
    )
    return {
      action: target.action,
      item,
      positionMs: target.positionMs,
      ...(durationMs === undefined ? {} : { durationMs }),
    }
  }
