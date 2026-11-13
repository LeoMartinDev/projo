import { appError, err } from '@projo/shared'

export const itemNotFound = (itemId: string) =>
  err(appError('item/not_found', 'item not found', { context: { id: itemId } }))

export const itemNotMatched = (itemId: string) =>
  err(
    appError('metadata/not_matched', 'the item is not identified on TMDB', {
      context: { id: itemId },
    }),
  )
