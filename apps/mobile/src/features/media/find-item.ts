import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { isRecord } from '../../shared/api/failure.ts'

/** A card's item (`ItemSummaryDto`: it has `genres`, an `ItemRefDto` like an episode's `series` has not). */
const isItem = (value: Record<string, unknown>, id: string): boolean =>
  value['id'] === id && typeof value['kind'] === 'string' && Array.isArray(value['genres'])

/**
 * The item `id` in the data of a cached query (home rows, a grid's pages, search results), the
 * first one met. The card sheet reads it there rather than from a copy, so it follows the fresh
 * data: a toggle shows its new state, "Remove" empties it.
 */
export const findItem = (data: unknown, id: string): ItemSummaryDto | undefined => {
  if (Array.isArray(data)) {
    for (const entry of data) {
      const found = findItem(entry, id)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isRecord(data)) return undefined
  if (isItem(data, id)) return data as ItemSummaryDto
  return findItem(Object.values(data), id)
}
