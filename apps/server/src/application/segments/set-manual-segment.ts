import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { SegmentRepository, SegmentType } from '../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import { markAbsentFactory, markersView, markManualFactory } from './shared/segment-markers.ts'
import type { SegmentTargetOf } from './shared/segment-target.ts'
import type { ItemSegmentsView } from './shared/segments-view.ts'

export type ManualMarker = { startMs: number; endMs: number } | { absent: true }

export type SetManualSegmentError = AppError<
  'item/not_found' | 'item/invalid_kind' | 'segment/invalid_range'
>

export const setManualSegmentFactory = ({
  segmentTarget,
  segmentRepository,
  settings,
  jobQueue,
  clock,
  logger,
}: {
  segmentTarget: SegmentTargetOf
  segmentRepository: SegmentRepository
  settings: SegmentSettingsReader
  jobQueue: JobQueue
  clock: Clock
  logger: Logger
}) => {
  const view = markersView(segmentRepository)
  const markAbsent = markAbsentFactory({ segmentRepository, clock })
  const markManual = markManualFactory({ segmentRepository, settings, jobQueue })

  return ({
    itemId,
    type,
    marker,
  }: {
    itemId: string
    type: SegmentType
    marker: ManualMarker
  }): Result<ItemSegmentsView, SetManualSegmentError> => {
    const target = segmentTarget(itemId)
    if (!target.ok) return err(target.error)
    const { durationMs } = target.value.ref
    if ('absent' in marker) {
      markAbsent(itemId, type)
      logger.info('negative segment marker set', { itemId, type })
      return ok(view(itemId, durationMs))
    }
    const { startMs, endMs } = marker
    if (startMs < 0 || endMs <= startMs || (durationMs !== undefined && endMs > durationMs)) {
      return err(
        appError('segment/invalid_range', 'segment outside the item duration', {
          context: { startMs, endMs, ...(durationMs === undefined ? {} : { durationMs }) },
        }),
      )
    }
    markManual(itemId, type, startMs, endMs)
    logger.info('manual segment set', { itemId, type, startMs, endMs })
    return ok(view(itemId, durationMs))
  }
}

export type SetManualSegment = ReturnType<typeof setManualSegmentFactory>
