import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import { requestSegments } from './shared/segment-requests.ts'

export const backfillBatch = 400

export const requestMissingSegmentsFactory =
  ({
    segmentCatalog,
    jobQueue,
    settings,
    clock,
  }: {
    segmentCatalog: SegmentCatalog
    jobQueue: JobQueue
    settings: SegmentSettingsReader
    clock: Clock
  }) =>
  (limit = backfillBatch): number => {
    const itemIds = segmentCatalog.listItemsToResolve({
      providers: settings.read().providers,
      now: clock.now(),
      limit,
    })
    for (const itemId of itemIds) requestSegments(jobQueue, itemId)
    return itemIds.length
  }

export type RequestMissingSegments = ReturnType<typeof requestMissingSegmentsFactory>
