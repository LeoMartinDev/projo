import { type AppError, ok, type Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

import type {
  EditableField,
  ItemOverrideRepository,
  ItemOverrides,
} from '../../../core/metadata/editing.ts'
import type { ItemKind } from '../../../core/metadata/ports.ts'
import { itemNotFound } from './item-errors.ts'

/** An item as the metadata editor shows it, with the fields its overrides lock (§9.3). */
export type ItemMetadataView = {
  id: string
  kind: ItemKind
  tmdbId?: number
  title?: string
  year?: number
  overview?: string
  genres: GenreId[]
  posterImageId?: string
  backdropImageId?: string
  locked: EditableField[]
  metadataRefreshedAt?: Date
}

const editableFields: readonly EditableField[] = [
  'title',
  'year',
  'overview',
  'genres',
  'poster',
  'backdrop',
]

const overrideKeyOf = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster: 'posterImageId',
  backdrop: 'backdropImageId',
} as const satisfies Record<EditableField, keyof ItemOverrides>

export const itemMetadataViewFactory =
  ({ overrides }: { overrides: Pick<ItemOverrideRepository, 'item' | 'get'> }) =>
  (itemId: string): Result<ItemMetadataView, AppError<'item/not_found'>> => {
    const item = overrides.item(itemId)
    if (item === undefined) return itemNotFound(itemId)
    const locked = overrides.get(item.id)
    return ok({
      ...item,
      locked: editableFields.filter((field) => locked[overrideKeyOf[field]] !== undefined),
    })
  }
