import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import { everything, type ItemKind, type VisibleItems } from '../../core/catalog/catalog.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import type { Source, SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, libraryNamesOf } from './library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'findById'>
  libraries: LibraryNames
  items: Pick<MetadataItemRepository, 'findItem' | 'sourcesUnder'>
  visibleItems: Pick<VisibleItems, 'findVisible'>
}

export type ItemFile = {
  source: Source
  library: string | undefined
  seasonNumber?: number
  episodeNumber?: number
}

export type ItemFilesView = {
  id: string
  kind: ItemKind
  title?: string
  year?: number
  tmdbId?: number
  files: ItemFile[]
}

export type GetItemFilesError = AppError<'item/not_found'>

export const getItemFilesFactory =
  ({ sources, libraries, items, visibleItems }: Deps) =>
  ({ itemId }: { itemId: string }): Result<ItemFilesView, GetItemFilesError> => {
    const info = items.findItem(itemId)
    if (info === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { id: itemId } }))
    }
    const item = visibleItems.findVisible({ id: itemId, scope: everything })
    const names = libraryNamesOf(libraries)
    return ok({
      id: itemId,
      kind: info.kind,
      ...(item?.title === undefined ? {} : { title: item.title }),
      ...(item?.year === undefined ? {} : { year: item.year }),
      ...(info.tmdbId === undefined ? {} : { tmdbId: info.tmdbId }),
      files: items.sourcesUnder(itemId).flatMap((link): ItemFile[] => {
        const source = sources.findById(link.sourceId)
        if (source === undefined) return []
        return [
          {
            source,
            library: names.get(source.libraryId),
            ...(link.seasonNumber === undefined ? {} : { seasonNumber: link.seasonNumber }),
            ...(link.episodeNumber === undefined ? {} : { episodeNumber: link.episodeNumber }),
          },
        ]
      }),
    })
  }

export type GetItemFiles = ReturnType<typeof getItemFilesFactory>
