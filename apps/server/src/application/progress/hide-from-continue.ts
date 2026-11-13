import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { VisibilityScope, VisibleItems } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { ProgressRepository } from '../../core/progress/progress.ts'
import { hideFromContinue } from '../../core/progress/rows.ts'

type Deps = {
  visibleItems: Pick<VisibleItems, 'findVisible'>
  progressRepository: ProgressRepository
  clock: Clock
}

export type HideFromContinueError = AppError<'item/not_found'>

export const hideFromContinueFactory =
  ({ visibleItems, progressRepository, clock }: Deps) =>
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
    let target = visibleItems.findVisible({ id: itemId, scope })
    for (let depth = 0; target !== undefined && depth < 2; depth += 1) {
      if (target.kind === 'movie' || target.kind === 'series' || target.parentId === undefined) {
        break
      }
      target = visibleItems.findVisible({ id: target.parentId, scope })
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
