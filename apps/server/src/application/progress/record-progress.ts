import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogRepository,
  isPlayableKind,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import {
  applyPosition,
  creditsStartOf,
  type ItemProgress,
  type ProgressRepository,
} from '../../core/progress/progress.ts'

type Deps = {
  catalogRepository: CatalogRepository
  progressRepository: ProgressRepository
  clock: Clock
}

export type RecordProgressError = AppError<
  'item/not_found' | 'progress/item_not_playable' | 'progress/invalid_position'
>

/** `PUT /items/:id/progress` (§13.1): position of the active profile on a movie or an episode. */
export const recordProgressFactory =
  ({ catalogRepository, progressRepository, clock }: Deps) =>
  async ({
    profileId,
    itemId,
    positionMs,
    durationMs,
    scope,
  }: {
    profileId: string
    itemId: string
    positionMs: number
    durationMs: number
    scope: VisibilityScope
  }): Promise<Result<ItemProgress, RecordProgressError>> => {
    const item = catalogRepository.findVisible({ id: itemId, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    if (!isPlayableKind(item.kind)) {
      return err(
        appError('progress/item_not_playable', 'progress is recorded on movies and episodes', {
          context: { itemId, kind: item.kind },
        }),
      )
    }
    if (durationMs <= 0 || positionMs > durationMs * 1.05) {
      return err(
        appError('progress/invalid_position', 'position outside the duration', {
          context: { positionMs, durationMs },
        }),
      )
    }
    const next = applyPosition(progressRepository.find({ profileId, itemId }), {
      profileId,
      itemId,
      positionMs,
      durationMs,
      at: clock.now(),
      // §12.4: entering the credits marks it watched, like 93 %.
      ...creditsStartOf(catalogRepository.listMediaSegments(itemId)),
    })
    progressRepository.save(next)
    // A play brings a series removed from the home rows back (§13.1).
    progressRepository.showAncestorsAgain({ profileId, itemId })
    return ok(next)
  }

export type RecordProgress = ReturnType<typeof recordProgressFactory>
