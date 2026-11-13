import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  isPlayableKind,
  type PlayableSources,
  type VisibilityScope,
  type VisibleItems,
} from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import {
  applyPosition,
  creditsStartOf,
  type ItemProgress,
  type ProgressRepository,
} from '../../core/progress/progress.ts'

type Deps = {
  visibleItems: Pick<VisibleItems, 'findVisible'>
  playableSources: Pick<PlayableSources, 'listMediaSegments'>
  progressRepository: ProgressRepository
  clock: Clock
}

export type RecordProgressError = AppError<
  'item/not_found' | 'progress/item_not_playable' | 'progress/invalid_position'
>

export const recordProgressFactory =
  ({ visibleItems, playableSources, progressRepository, clock }: Deps) =>
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
    const item = visibleItems.findVisible({ id: itemId, scope })
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
      ...creditsStartOf(playableSources.listMediaSegments(itemId)),
    })
    progressRepository.save(next)
    progressRepository.showAncestorsAgain({ profileId, itemId })
    return ok(next)
  }

export type RecordProgress = ReturnType<typeof recordProgressFactory>
