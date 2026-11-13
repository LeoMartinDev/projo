import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import {
  type CatalogItem,
  isPlayableKind,
  type VisibilityScope,
  type VisibleItems,
} from '../../../core/catalog/catalog.ts'

export type TrackPreferencesError = AppError<'item/not_found' | 'item/invalid_kind'>

export type TrackPreferenceTarget = { profileId: string; itemId: string; scope: VisibilityScope }

export const playableItem = (
  visibleItems: Pick<VisibleItems, 'findVisible'>,
  { itemId, scope }: TrackPreferenceTarget,
): Result<CatalogItem, TrackPreferencesError> => {
  const item = visibleItems.findVisible({ id: itemId, scope })
  if (item === undefined) {
    return err(appError('item/not_found', 'item not found', { context: { itemId } }))
  }
  if (!isPlayableKind(item.kind)) {
    return err(
      appError('item/invalid_kind', 'track preferences are set from a movie or an episode', {
        context: { itemId, kind: item.kind },
      }),
    )
  }
  return ok(item)
}
