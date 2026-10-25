import type { ItemSegmentsDto, SegmentLookupDto } from '@projo/shared/api/segments'

import type { ItemSegmentsView } from '../../../application/segments/types.ts'

/** The chain's sources; `no_segment:<type>` rows are negative markers, sent as `absent`. */
const lookupSources = new Set<string>(['chapter', 'theintrodb', 'introdb', 'skipdb', 'fingerprint'])

export const toItemSegmentsDto = (view: ItemSegmentsView): ItemSegmentsDto => ({
  itemId: view.itemId,
  ...(view.durationMs === undefined ? {} : { durationMs: view.durationMs }),
  segments: view.segments
    .toSorted((a, b) => a.startMs - b.startMs)
    .map((segment) => ({
      type: segment.type,
      startMs: segment.startMs,
      endMs: segment.endMs,
      origin: segment.origin,
      ...(segment.confidence === undefined ? {} : { confidence: segment.confidence }),
    })),
  absent: view.absent,
  lookups: view.lookups
    .filter((row) => lookupSources.has(row.provider))
    .map((row) => ({
      source: row.provider as SegmentLookupDto['source'],
      outcome: row.outcome,
      checkedAt: row.checkedAt.toISOString(),
    })),
})
