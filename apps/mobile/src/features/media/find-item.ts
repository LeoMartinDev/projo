import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { isRecord } from '../../shared/api/failure.ts'

const isItem = (value: Record<string, unknown>, id: string): boolean =>
  value['id'] === id && typeof value['kind'] === 'string' && Array.isArray(value['genres'])

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
