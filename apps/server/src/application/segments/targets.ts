import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { everything, isPlayableKind, type PlayableSources } from '../../core/catalog/catalog.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import { type ItemTimeline, itemTimeline } from '../../core/segments/chapters.ts'
import {
  type SegmentItemRef,
  type SegmentLookupKey,
  type SegmentRepository,
  type SegmentType,
  segmentTypes,
} from '../../core/segments/segment.ts'
import type { ItemSegmentsView } from './types.ts'

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

export const negativeMarkerType = (key: SegmentLookupKey): SegmentType | undefined => {
  const type = key.startsWith('no_segment:') ? key.slice('no_segment:'.length) : undefined
  return segmentTypes.find((candidate) => candidate === type)
}

export const segmentsView = (
  segmentRepository: Pick<SegmentRepository, 'listByItem' | 'listLookups'>,
  {
    itemId,
    durationMs,
    withLookups,
  }: { itemId: string; durationMs?: number; withLookups: boolean },
): ItemSegmentsView => {
  const lookups = segmentRepository.listLookups(itemId)
  const absent = lookups.flatMap((row) => {
    const type = negativeMarkerType(row.provider)
    return type === undefined ? [] : [type]
  })
  return {
    itemId,
    ...(durationMs === undefined ? {} : { durationMs }),
    segments: segmentRepository.listByItem(itemId),
    absent: segmentTypes.filter((type) => absent.includes(type)),
    lookups: withLookups
      ? lookups.filter((row) => negativeMarkerType(row.provider) === undefined)
      : [],
  }
}

export const requestSegments = (jobQueue: JobQueue, itemId: string): void => {
  jobQueue.enqueue({ type: 'fetch_segments', payload: { itemId }, dedupeKey: `segments:${itemId}` })
}

export const requestSubmission = (jobQueue: JobQueue, itemId: string, type: SegmentType): void => {
  jobQueue.enqueue({
    type: 'submit_segment',
    payload: { itemId, type },
    dedupeKey: `submit:${itemId}:${type}`,
  })
}
