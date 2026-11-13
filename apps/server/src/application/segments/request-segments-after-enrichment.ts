import { isPlayableKind } from '../../core/catalog/catalog.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import { requestSegments } from './shared/segment-requests.ts'

export const requestSegmentsAfterEnrichmentFactory =
  ({ segmentCatalog, jobQueue }: { segmentCatalog: SegmentCatalog; jobQueue: JobQueue }) =>
  (itemId: string): boolean => {
    const facts = segmentCatalog.findItem(itemId)
    if (facts === undefined || !isPlayableKind(facts.kind) || !facts.detectSegments) return false
    requestSegments(jobQueue, itemId)
    return true
  }

export type RequestSegmentsAfterEnrichment = ReturnType<
  typeof requestSegmentsAfterEnrichmentFactory
>
