import type { GenreId } from '@projo/shared/api/genres'

import type { CatalogItem, VisibilityScope, VisibleItems } from '../../../core/catalog/catalog.ts'

export type MemoryTarget = {
  ownerId: string
  originalLanguage?: string
  genres: readonly GenreId[]
}

export const memoryTargetOf = (
  visibleItems: Pick<VisibleItems, 'findVisible'>,
  item: CatalogItem,
  scope: VisibilityScope,
): MemoryTarget => {
  let series: CatalogItem | undefined
  let current: CatalogItem | undefined = item
  for (let depth = 0; depth < 2 && current?.parentId !== undefined; depth += 1) {
    current = visibleItems.findVisible({ id: current.parentId, scope })
    if (current?.kind === 'series') series = current
  }
  const owner = item.kind === 'episode' ? (series ?? item) : item
  const originalLanguage = item.originalLanguage ?? series?.originalLanguage
  return {
    ownerId: owner.id,
    ...(originalLanguage === undefined ? {} : { originalLanguage }),
    genres: owner.genres,
  }
}
