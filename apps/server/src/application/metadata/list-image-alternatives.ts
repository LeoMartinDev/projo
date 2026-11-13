import { type AppError, ok, type Result } from '@projo/shared'

import type {
  EditableImageKind,
  ImageAlternative,
  ItemOverrideRepository,
} from '../../core/metadata/editing.ts'
import type {
  ImageRepository,
  MetadataItemRepository,
  MetadataSettings,
} from '../../core/metadata/ports.ts'
import type { TmdbApi, TmdbError } from '../../core/metadata/tmdb.ts'
import { tmdbImageAlternativesFactory } from './shared/image-alternatives.ts'
import { itemNotFound } from './shared/item-errors.ts'

type Deps = {
  overrides: Pick<ItemOverrideRepository, 'item'>
  items: Pick<MetadataItemRepository, 'imageContext'>
  images: Pick<ImageRepository, 'itemImage'>
  tmdb: Pick<TmdbApi, 'images'>
  settings: Pick<MetadataSettings, 'language'>
}

export type ListImageAlternativesError =
  TmdbError | AppError<'item/not_found' | 'metadata/not_matched'>

export const listImageAlternativesFactory = ({
  overrides,
  items,
  images,
  tmdb,
  settings,
}: Deps) => {
  const alternativesOf = tmdbImageAlternativesFactory({ items, settings, tmdb })
  return async ({
    itemId,
    kind,
  }: {
    itemId: string
    kind: EditableImageKind
  }): Promise<Result<(ImageAlternative & { current: boolean })[], ListImageAlternativesError>> => {
    if (overrides.item(itemId) === undefined) return itemNotFound(itemId)
    const found = await alternativesOf(itemId, kind)
    if (!found.ok) return found
    const current = images.itemImage({ itemId, slot: kind })?.tmdbPath
    return ok(found.value.map((image) => ({ ...image, current: image.tmdbPath === current })))
  }
}

export type ListImageAlternatives = ReturnType<typeof listImageAlternativesFactory>
