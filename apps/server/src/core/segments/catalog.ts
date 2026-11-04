import type { ItemKind } from '../catalog/catalog.ts'
import type { SegmentItemRef, SegmentProviderId } from './segment.ts'

export type SegmentItemFacts = Omit<SegmentItemRef, 'kind' | 'durationMs'> & {
  kind: ItemKind
  sharesFile: boolean
}

export type SegmentCatalog = {
  findItem: (itemId: string) => SegmentItemFacts | undefined
  listSeasonEpisodeIds: (seasonId: string) => string[]
  listUnidentifiedItemIds: (sourceId: string) => string[]
  listItemsToResolve: (input: {
    providers: readonly SegmentProviderId[]
    now: Date
    limit: number
  }) => string[]
}
