import type { CatalogItem, CatalogRepository, VisibilityScope } from '../../core/catalog/catalog.ts'
import type { ProgressRepository } from '../../core/progress/progress.ts'
import { seriesPlayTarget } from '../../core/progress/rows.ts'

/**
 * A main button: `resume` ("Resume S2 · E4", "Resume at 1:12") at `positionMs`, or `play`
 * ("Play") from the start. `item` is the movie or the episode it plays.
 */
export type PlayButton = { action: 'resume' | 'play'; item: CatalogItem; positionMs: number }

type Deps = { catalogRepository: CatalogRepository; progressRepository: ProgressRepository }

export type SeriesPlay = (input: {
  profileId: string
  seriesId: string
  /** Restricts the choice to one season (the season page). */
  seasonNumber?: number
  scope: VisibilityScope
}) => PlayButton | undefined

/** "Resume S2 · E4" / "Play" of a series or a season (§13.5), from the profile's progress. */
export const seriesPlayFactory =
  ({ catalogRepository, progressRepository }: Deps): SeriesPlay =>
  ({ profileId, seriesId, seasonNumber, scope }) => {
    const episodes = catalogRepository
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
        : catalogRepository.findVisible({ id: target.episode.id, scope })
    return target === undefined || item === undefined
      ? undefined
      : { action: target.action, item, positionMs: target.positionMs }
  }
