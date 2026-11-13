import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { VisibilityScope, VisibleItems } from '../../../core/catalog/catalog.ts'

export type WatchlistItemError = AppError<'item/not_found' | 'item/invalid_kind'>

/** A movie or a series the profile sees: only those go in the watchlist. */
export const listableItem = (
  visibleItems: Pick<VisibleItems, 'findVisible'>,
  itemId: string,
  scope: VisibilityScope,
): Result<string, WatchlistItemError> => {
  const item = visibleItems.findVisible({ id: itemId, scope })
  if (item === undefined) {
    return err(appError('item/not_found', 'item not found', { context: { itemId } }))
  }
  if (item.kind !== 'movie' && item.kind !== 'series') {
    return err(
      appError('item/invalid_kind', 'only movies and series go in the watchlist', {
        context: { itemId, kind: item.kind },
      }),
    )
  }
  return ok(item.id)
}
