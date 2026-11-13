import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import {
  noSegmentKey,
  type SegmentRepository,
  type SegmentType,
} from '../../core/segments/segment.ts'
import { negativeMarkerType } from './shared/segment-markers.ts'
import { requestSegments } from './shared/segment-requests.ts'
import type { SegmentTargetOf } from './shared/segment-target.ts'
import { type ItemSegmentsView, markersView } from './shared/segments-view.ts'

export type RemoveSegmentError = AppError<'item/not_found' | 'segment/not_found'>

export const removeSegmentFactory = ({
  segmentTarget,
  segmentRepository,
  jobQueue,
  logger,
}: {
  segmentTarget: SegmentTargetOf
  segmentRepository: SegmentRepository
  jobQueue: JobQueue
  logger: Logger
}) => {
  const view = markersView(segmentRepository)

  return ({
    itemId,
    type,
  }: {
    itemId: string
    type: SegmentType
  }): Result<ItemSegmentsView, RemoveSegmentError> => {
    const target = segmentTarget(itemId)
    if (!target.ok) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    const lookups = segmentRepository.listLookups(itemId)
    const hadMarker = lookups.some((row) => row.provider === noSegmentKey(type))
    const removed = segmentRepository.remove({ itemId, type })
    if (!removed && !hadMarker) {
      return err(
        appError('segment/not_found', 'no segment of that type', { context: { itemId, type } }),
      )
    }
    segmentRepository.removeLookup({ itemId, provider: noSegmentKey(type) })
    for (const row of lookups) {
      if (negativeMarkerType(row.provider) === undefined) {
        segmentRepository.removeLookup({ itemId, provider: row.provider })
      }
    }
    requestSegments(jobQueue, itemId)
    logger.info('segment removed', { itemId, type })
    return ok(view(itemId, target.value.ref.durationMs))
  }
}

export type RemoveSegment = ReturnType<typeof removeSegmentFactory>
