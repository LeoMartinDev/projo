import { isPlayableKind } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { SegmentCatalog } from '../../core/segments/catalog.ts'
import {
  type SegmentLookupKey,
  type SegmentRepository,
  segmentProviderIds,
} from '../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import { requestSegments } from './targets.ts'

type Deps = {
  segmentCatalog: SegmentCatalog
  segmentRepository: Pick<SegmentRepository, 'listLookups' | 'removeLookup'>
  jobQueue: JobQueue
}

const providerKeys = new Set<SegmentLookupKey>(segmentProviderIds)

/**
 * §12.2 "after the enrichment of an episode or a movie": the identification may have brought
 * the ids the databases are asked with (or changed them, a rematch), so their cached `none` and
 * `error` answers are forgotten before the chain runs again. `found` answers stay (never retried).
 */
export const requestSegmentsAfterEnrichmentFactory =
  ({ segmentCatalog, segmentRepository, jobQueue }: Deps) =>
  (itemId: string): boolean => {
    const facts = segmentCatalog.findItem(itemId)
    if (facts === undefined || !isPlayableKind(facts.kind) || !facts.detectSegments) return false
    for (const row of segmentRepository.listLookups(itemId)) {
      if (providerKeys.has(row.provider) && row.outcome !== 'found') {
        segmentRepository.removeLookup({ itemId, provider: row.provider })
      }
    }
    requestSegments(jobQueue, itemId)
    return true
  }

/** Per run of the backfill: TheIntroDB answers 500 requests a day without a key (§12.2). */
export const backfillBatch = 400

/**
 * Backfill and retries (§12.2): movies and episodes identified before M4 (or whose enrichment
 * never completed), and those an enabled provider has no fresh answer for (`none` after 30 days,
 * `error` after 7, a provider enabled since, or skipped by a rate limit or an interrupted job).
 * A bounded batch, oldest first, goes to `fetch_segments`.
 */
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

/**
 * After `match_source` (§12.2 row 2): a file left unidentified (unknown to TMDB, to review, TMDB
 * unreachable) is never enriched, so its chapters would wait for the daily backfill. Its movies
 * and episodes never resolved go to `fetch_segments` now; without ids the databases are not
 * asked, and the chain runs again once the item is identified (`fetch_images`).
 */
export const requestSegmentsOfUnidentifiedSourceFactory =
  ({ segmentCatalog, jobQueue }: Pick<Deps, 'segmentCatalog' | 'jobQueue'>) =>
  (sourceId: string): number => {
    const itemIds = segmentCatalog.listUnidentifiedItemIds(sourceId)
    for (const itemId of itemIds) requestSegments(jobQueue, itemId)
    return itemIds.length
  }
