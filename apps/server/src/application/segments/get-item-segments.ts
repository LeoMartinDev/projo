import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  isPlayableKind,
  type PlayableSources,
  type VisibilityScopeResolver,
  type VisibleItems,
} from '../../core/catalog/catalog.ts'
import { itemTimeline } from '../../core/segments/chapters.ts'
import type { SegmentRepository } from '../../core/segments/segment.ts'
import { type ItemSegmentsView, segmentsView } from './shared/segments-view.ts'

export type GetItemSegmentsError = AppError<'item/not_found' | 'item/invalid_kind'>

export const getItemSegmentsFactory =
  ({
    visibleItems,
    playableSources,
    segmentRepository,
    visibilityScope,
  }: {
    visibleItems: Pick<VisibleItems, 'findVisible'>
    playableSources: Pick<PlayableSources, 'listReadySources'>
    segmentRepository: SegmentRepository
    visibilityScope: VisibilityScopeResolver
  }) =>
  ({
    itemId,
    profileId,
    withLookups,
  }: {
    itemId: string
    profileId: string
    withLookups: boolean
  }): Result<ItemSegmentsView, GetItemSegmentsError> => {
    const scope = visibilityScope(profileId)
    const item = visibleItems.findVisible({ id: itemId, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    if (!isPlayableKind(item.kind)) {
      return err(
        appError('item/invalid_kind', 'segments exist on movies and episodes', {
          context: { itemId, kind: item.kind },
        }),
      )
    }
    const { durationMs } = itemTimeline(playableSources.listReadySources({ itemId, scope }))
    return ok(
      segmentsView(segmentRepository, {
        itemId,
        ...(durationMs === undefined ? {} : { durationMs }),
        withLookups,
      }),
    )
  }

export type GetItemSegments = ReturnType<typeof getItemSegmentsFactory>
