import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import { requestSegments } from './shared/segment-requests.ts'

export const requestSegmentsOfUnidentifiedSourceFactory =
  ({ segmentCatalog, jobQueue }: { segmentCatalog: SegmentCatalog; jobQueue: JobQueue }) =>
  (sourceId: string): number => {
    const itemIds = segmentCatalog.listUnidentifiedItemIds(sourceId)
    for (const itemId of itemIds) requestSegments(jobQueue, itemId)
    return itemIds.length
  }

export type RequestSegmentsOfUnidentifiedSource = ReturnType<
  typeof requestSegmentsOfUnidentifiedSourceFactory
>
