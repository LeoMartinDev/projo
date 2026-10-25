import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogRepository, VisibilityScope } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { ProgressRepository } from '../../core/progress/progress.ts'
import { hideFromContinue } from '../../core/progress/rows.ts'

type Deps = {
  catalogRepository: CatalogRepository
  progressRepository: ProgressRepository
  clock: Clock
}

export type HideFromContinueError = AppError<'item/not_found'>

/**
 * `POST /items/:id/hide-from-continue` ("Remove", §13.1): a movie leaves "Continue watching";
 * an episode, a season or a series takes its series out of "Continue watching" and "Up next".
 * The next play brings it back. Answers the id of the hidden movie or series.
 */
export const hideFromContinueFactory =
  ({ catalogRepository, progressRepository, clock }: Deps) =>
  async ({
    profileId,
    itemId,
    scope,
  }: {
    profileId: string
    itemId: string
    scope: VisibilityScope
  }): Promise<Result<string, HideFromContinueError>> => {
    const notFound = () =>
      err(appError('item/not_found', 'item not found', { context: { itemId } }))
    let target = catalogRepository.findVisible({ id: itemId, scope })
    // Up to the series: episode → season → series.
    for (let depth = 0; target !== undefined && depth < 2; depth += 1) {
      if (target.kind === 'movie' || target.kind === 'series' || target.parentId === undefined) {
        break
      }
      target = catalogRepository.findVisible({ id: target.parentId, scope })
    }
    if (target === undefined || (target.kind !== 'movie' && target.kind !== 'series')) {
      return notFound()
    }
    const previous = progressRepository.find({ profileId, itemId: target.id })
    progressRepository.save(
      hideFromContinue(previous, { profileId, itemId: target.id, at: clock.now() }),
    )
    return ok(target.id)
  }

export type HideFromContinue = ReturnType<typeof hideFromContinueFactory>
