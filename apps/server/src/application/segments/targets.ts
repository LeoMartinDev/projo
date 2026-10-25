import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type CatalogRepository, everything, isPlayableKind } from '../../core/catalog/catalog.ts'
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

/**
 * A movie or an episode as the chain sees it: what providers are asked with, its timeline, and
 * whether its file holds other items too (§8.4: the timeline is then the file's, not its own).
 */
export type SegmentTarget = { ref: SegmentItemRef; timeline: ItemTimeline; sharesFile: boolean }

export type TargetDeps = {
  segmentCatalog: SegmentCatalog
  catalogRepository: Pick<CatalogRepository, 'listReadySources'>
}

export type TargetError = AppError<'item/not_found' | 'item/invalid_kind'>

/** Any profile: jobs and admin routes. */
export const segmentTargetFactory =
  ({ segmentCatalog, catalogRepository }: TargetDeps) =>
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
    const timeline = itemTimeline(catalogRepository.listReadySources({ itemId, scope: everything }))
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

/** What `GET /items/:id/segments` and the admin marker routes answer. */
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

/** `fetch_segments` (§18): one per item. */
export const requestSegments = (jobQueue: JobQueue, itemId: string): void => {
  jobQueue.enqueue({ type: 'fetch_segments', payload: { itemId }, dedupeKey: `segments:${itemId}` })
}

/** `submit_segment` (§12.5): one per item and type. */
export const requestSubmission = (jobQueue: JobQueue, itemId: string, type: SegmentType): void => {
  jobQueue.enqueue({
    type: 'submit_segment',
    payload: { itemId, type },
    dedupeKey: `submit:${itemId}:${type}`,
  })
}
