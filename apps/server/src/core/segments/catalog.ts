import type { ItemKind } from '../catalog/catalog.ts'
import type { SegmentItemRef, SegmentProviderId } from './segment.ts'

/**
 * What the segment use cases read about an item, whatever the profile (jobs and admin routes):
 * its kind and what the providers are asked with. Durations and chapters come from the ready
 * sources (`CatalogRepository.listReadySources`, `itemTimeline`).
 */
export type SegmentItemFacts = Omit<SegmentItemRef, 'kind' | 'durationMs'> & {
  kind: ItemKind
  /**
   * A ready source of the item also holds other items (§8.4 "E01-E02"): the databases answer
   * per episode on the episode's own timeline, which the file's does not match past the first.
   */
  sharesFile: boolean
}

export type SegmentCatalog = {
  findItem: (itemId: string) => SegmentItemFacts | undefined
  /** Every episode of a season, in episode order. */
  listSeasonEpisodeIds: (seasonId: string) => string[]
  /**
   * Backfill and retries (§12.2): movies and episodes with a ready source in a `detect_segments`
   * library and either no `segment_lookups` row at all, or, when the databases can be asked (an
   * external id, no shared file) and a type is still unknown, an enabled provider without a
   * fresh answer (`isLookupFresh` at `now`). Never resolved first, then the oldest answers.
   */
  /**
   * Movies and episodes of a ready source left unidentified (`unmatched`, `needs_review`) in a
   * `detect_segments` library, with no `segment_lookups` row yet: no enrichment will start their
   * chain, while the file's chapters can already be read (§12.2 row 2).
   */
  listUnidentifiedItemIds: (sourceId: string) => string[]
  listItemsToResolve: (input: {
    providers: readonly SegmentProviderId[]
    now: Date
    limit: number
  }) => string[]
}
