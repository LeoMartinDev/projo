import type { AppError, Result } from '@projo/shared'

import type { ItemOverrideRepository } from '../../core/metadata/editing.ts'
import { type ItemMetadataView, itemMetadataViewFactory } from './shared/item-metadata-view.ts'

export type GetItemMetadataError = AppError<'item/not_found'>

export const getItemMetadataFactory = ({
  overrides,
}: {
  overrides: Pick<ItemOverrideRepository, 'item' | 'get'>
}) => {
  const view = itemMetadataViewFactory({ overrides })
  return ({ itemId }: { itemId: string }): Result<ItemMetadataView, GetItemMetadataError> =>
    view(itemId)
}

export type GetItemMetadata = ReturnType<typeof getItemMetadataFactory>
