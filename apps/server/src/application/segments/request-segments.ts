import { isPlayableKind } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import { requestSegments } from './targets.ts'

type Deps = {
  segmentCatalog: SegmentCatalog
  jobQueue: JobQueue
}

export const requestSegmentsAfterEnrichmentFactory =
  ({ segmentCatalog, jobQueue }: Deps) =>
  (itemId: string): boolean => {
    const facts = segmentCatalog.findItem(itemId)
    if (facts === undefined || !isPlayableKind(facts.kind) || !facts.detectSegments) return false
    requestSegments(jobQueue, itemId)
    return true
  }

export const backfillBatch = 400

export const requestMissingSegmentsFactory =
  ({
    segmentCatalog,
    jobQueue,
    settings,
    clock,
  }: Pick<Deps, 'segmentCatalog' | 'jobQueue'> & {
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

export const requestSegmentsOfUnidentifiedSourceFactory =
  ({ segmentCatalog, jobQueue }: Pick<Deps, 'segmentCatalog' | 'jobQueue'>) =>
  (sourceId: string): number => {
    const itemIds = segmentCatalog.listUnidentifiedItemIds(sourceId)
    for (const itemId of itemIds) requestSegments(jobQueue, itemId)
    return itemIds.length
  }
