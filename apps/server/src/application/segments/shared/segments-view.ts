import {
  type Segment,
  type SegmentLookupRow,
  type SegmentRepository,
  type SegmentType,
  segmentTypes,
} from '../../../core/segments/segment.ts'
import { negativeMarkerType } from './segment-markers.ts'

export type ItemSegmentsView = {
  itemId: string
  durationMs?: number
  segments: Segment[]
  absent: SegmentType[]
  lookups: SegmentLookupRow[]
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

/** The segments of an item as the admin editor shows them, chain lookups included. */
export const markersView =
  (segmentRepository: Pick<SegmentRepository, 'listByItem' | 'listLookups'>) =>
  (itemId: string, durationMs: number | undefined) =>
    segmentsView(segmentRepository, {
      itemId,
      ...(durationMs === undefined ? {} : { durationMs }),
      withLookups: true,
    })
