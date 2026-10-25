import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogRepository,
  isPlayableKind,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import {
  type ItemProgress,
  markUnwatched,
  markWatched,
  type ProgressRepository,
} from '../../core/progress/progress.ts'
import type { ProgressView, ProgressViews } from './progress-views.ts'

type Deps = {
  catalogRepository: CatalogRepository
  progressRepository: ProgressRepository
  progressViews: ProgressViews
  clock: Clock
}

export type SetWatchedError = AppError<'item/not_found'>

/**
 * `POST|DELETE /items/:id/watched` (§13.1 "Marquer vu / non vu"): on a movie or an episode, or
 * on every visible episode of a season or a series. "Non vu" puts the position back to 0.
 */
export const setWatchedFactory =
  ({ catalogRepository, progressRepository, progressViews, clock }: Deps) =>
  async ({
    profileId,
    itemId,
    watched,
    scope,
  }: {
    profileId: string
    itemId: string
    watched: boolean
    scope: VisibilityScope
  }): Promise<Result<ProgressView, SetWatchedError>> => {
    const item = catalogRepository.findVisible({ id: itemId, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    const episodeIds = isPlayableKind(item.kind)
      ? [item.id]
      : catalogRepository
          .listVisibleEpisodeIds({ ancestorIds: [item.id], scope })
          .map((episode) => episode.episodeId)
    const previous = progressRepository.findMany({ profileId, itemIds: episodeIds })
    const at = clock.now()
    const next = episodeIds.flatMap((id): ItemProgress[] => {
      const before = previous.get(id)
      if (watched) return [markWatched(before, { profileId, itemId: id, at })]
      return before === undefined ? [] : [markUnwatched(before)]
    })
    progressRepository.saveMany(next)
    const view = progressViews({ profileId, items: [item], scope }).get(item.id)
    if (view === undefined) throw new Error(`no progress view for ${item.id}`)
    return ok(view)
  }

export type SetWatched = ReturnType<typeof setWatchedFactory>
