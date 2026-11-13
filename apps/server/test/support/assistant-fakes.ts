import type { CatalogItem } from '../../src/core/catalog/catalog.ts'
import type { Library } from '../../src/core/library/library.ts'
import type { LinkedItemInfo } from '../../src/core/metadata/linking.ts'
import type { MetadataItemRepository } from '../../src/core/metadata/ports.ts'
import type { SourceListItem, SourceRepository } from '../../src/core/source/source.ts'

export const library = (id: string, name: string): Library => ({
  id,
  name,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  roots: [],
  hint: 'auto',
  scanIntervalMinutes: 15,
  watchEnabled: true,
  quietPeriodSeconds: 120,
  detectSegments: true,
  preExtractSubtitles: false,
  trickplayEnabled: true,
  ratingCountry: 'FR',
})

export const source = (
  id: string,
  overrides: Partial<SourceListItem> & { relativePath: string },
): SourceListItem => ({
  id,
  libraryId: 'lib-1',
  rootId: 'root-1',
  rootPath: '/media',
  state: 'ready',
  sizeBytes: 1000,
  mtimeMs: 0,
  classification: 'episode',
  parsed: {},
  matchState: 'needs_review',
  extension: 'mkv',
  discoveredAt: new Date('2026-01-01T00:00:00.000Z'),
  itemIds: [],
  items: [],
  ...overrides,
})

export const catalogItem = (
  id: string,
  overrides: Partial<CatalogItem> & Pick<CatalogItem, 'kind'>,
): CatalogItem => ({
  id,
  sortTitle: overrides.title ?? id,
  genres: [],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
})

type PageQuery = Parameters<SourceRepository['page']>[0]

/** In-memory `SourceRepository` reads: filters like the SQL page, without a real cursor. */
export const inMemorySources = (rows: readonly SourceListItem[]) => {
  const queries: PageQuery[] = []
  const sources: Pick<SourceRepository, 'findById' | 'page' | 'reviewSummary'> = {
    findById: (id) => rows.find((row) => row.id === id),
    page: (query) => {
      queries.push(query)
      const matching = rows.filter(
        (row) =>
          (query.libraryId === undefined || row.libraryId === query.libraryId) &&
          (query.state === undefined || row.state === query.state) &&
          (query.matchState === undefined || row.matchState === query.matchState) &&
          (query.reviewReason === undefined || row.reviewReason === query.reviewReason),
      )
      const items = matching.slice(0, query.limit)
      return {
        total: matching.length,
        items,
        ...(matching.length > query.limit ? { nextCursor: items.at(-1)?.id ?? '' } : {}),
      }
    },
    reviewSummary: () => ({
      toReview: [],
      byState: { pending: 0, ready: 0, missing: 0, rejected: 0 },
    }),
  }
  return { sources, queries }
}

// SQLite compares text by bytes and sorts NULL first in ascending order
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const byOptional = (a: number | undefined, b: number | undefined): number =>
  (a ?? Number.NEGATIVE_INFINITY) - (b ?? Number.NEGATIVE_INFINITY)

/**
 * In-memory `MetadataItemRepository` reads over items and their source links, like the SQLite
 * adapter: `sourcesUnder` covers the item, its children and grandchildren, takes the numbers of
 * the linked item, and keeps one row per source.
 */
export const inMemoryItems = ({
  items,
  links = [],
}: {
  items: readonly LinkedItemInfo[]
  links?: readonly { itemId: string; sourceId: string }[]
}): Pick<MetadataItemRepository, 'findItem' | 'linkedItems' | 'sourcesUnder'> => {
  const findItem = (id: string) => items.find((item) => item.id === id)
  return {
    findItem,
    linkedItems: (sourceId) =>
      links
        .filter((link) => link.sourceId === sourceId)
        .flatMap((link) => findItem(link.itemId) ?? []),
    sourcesUnder: (itemId) => {
      const children = new Set(items.filter((item) => item.parentId === itemId).map(({ id }) => id))
      const under = (item: LinkedItemInfo) =>
        item.id === itemId ||
        item.parentId === itemId ||
        (item.parentId !== undefined && children.has(item.parentId))
      const rows = links
        .flatMap((link) => {
          const item = findItem(link.itemId)
          return item === undefined || !under(item) ? [] : [{ sourceId: link.sourceId, item }]
        })
        .toSorted(
          (a, b) =>
            byText(a.sourceId, b.sourceId) ||
            byOptional(a.item.seasonNumber, b.item.seasonNumber) ||
            byOptional(a.item.episodeNumber, b.item.episodeNumber),
        )
      const bySource = new Map<
        string,
        { sourceId: string; seasonNumber?: number; episodeNumber?: number }
      >()
      for (const { sourceId, item } of rows) {
        if (bySource.has(sourceId)) continue
        bySource.set(sourceId, {
          sourceId,
          ...(item.seasonNumber === undefined ? {} : { seasonNumber: item.seasonNumber }),
          ...(item.episodeNumber === undefined ? {} : { episodeNumber: item.episodeNumber }),
        })
      }
      return [...bySource.values()]
    },
  }
}
