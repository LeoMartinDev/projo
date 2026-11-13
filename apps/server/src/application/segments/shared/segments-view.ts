import {
  type Segment,
  type SegmentLookupKey,
  type SegmentLookupRow,
  type SegmentRepository,
  type SegmentType,
  segmentTypes,
} from '../../../core/segments/segment.ts'

export type ItemSegmentsView = {
  itemId: string
  durationMs?: number
  segments: Segment[]
  absent: SegmentType[]
  lookups: SegmentLookupRow[]
}

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
