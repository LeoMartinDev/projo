import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { everything, isPlayableKind, type PlayableSources } from '../../../core/catalog/catalog.ts'
import type { SegmentCatalog } from '../../../core/segments/catalog.ts'
import { type ItemTimeline, itemTimeline } from '../../../core/segments/chapters.ts'
import type { SegmentItemRef } from '../../../core/segments/segment.ts'

export type SegmentTarget = { ref: SegmentItemRef; timeline: ItemTimeline; sharesFile: boolean }

export type TargetDeps = {
  segmentCatalog: SegmentCatalog
  playableSources: Pick<PlayableSources, 'listReadySources'>
}

export type TargetError = AppError<'item/not_found' | 'item/invalid_kind'>

export const segmentTargetFactory =
  ({ segmentCatalog, playableSources }: TargetDeps) =>
  (itemId: string): Result<SegmentTarget, TargetError> => {
    const facts = segmentCatalog.findItem(itemId)
    if (facts === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    const { kind, sharesFile, ...rest } = facts
    if (!isPlayableKind(kind)) {
      return err(
        appError('item/invalid_kind', 'segments exist on movies and episodes', {
          context: { itemId, kind },
        }),
      )
    }
    const timeline = itemTimeline(playableSources.listReadySources({ itemId, scope: everything }))
    return ok({
      ref: {
        ...rest,
        kind,
        ...(timeline.durationMs === undefined ? {} : { durationMs: timeline.durationMs }),
      },
      timeline,
      sharesFile,
    })
  }

export type SegmentTargetOf = ReturnType<typeof segmentTargetFactory>
