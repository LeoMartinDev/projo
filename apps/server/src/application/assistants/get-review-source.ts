import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import { everything, type ItemKind, type VisibleItems } from '../../core/catalog/catalog.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import { directoryOf, showFolderOf } from '../../core/naming/index.ts'
import type { Source, SourceListItem, SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, libraryNamesOf } from './shared/library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'findById' | 'page'>
  libraries: LibraryNames
  items: Pick<MetadataItemRepository, 'findItem' | 'linkedItems'>
  visibleItems: Pick<VisibleItems, 'findVisible'>
}

export type ReviewItemLabel = {
  id: string
  kind: ItemKind | undefined
  title?: string
  tmdbId?: number
  seasonNumber?: number
  episodeNumber?: number
}

export type ReviewSourceView = {
  source: Source
  library: string | undefined
  items: ReviewItemLabel[]
  sameFolderToReview: SourceListItem[]
}

export type GetReviewSourceError = AppError<'source/not_found'>

const neighbourLimit = 500

export const getReviewSourceFactory = ({ sources, libraries, items, visibleItems }: Deps) => {
  const itemLabel = (id: string): ReviewItemLabel => {
    const item = visibleItems.findVisible({ id, scope: everything })
    const info = items.findItem(id)
    return {
      id,
      kind: info?.kind ?? item?.kind,
      ...(item?.title === undefined ? {} : { title: item.title }),
      ...(info?.tmdbId === undefined ? {} : { tmdbId: info.tmdbId }),
      ...(info?.seasonNumber === undefined ? {} : { seasonNumber: info.seasonNumber }),
      ...(info?.episodeNumber === undefined ? {} : { episodeNumber: info.episodeNumber }),
    }
  }

  return ({ sourceId }: { sourceId: string }): Result<ReviewSourceView, GetReviewSourceError> => {
    const source = sources.findById(sourceId)
    if (source === undefined) {
      return err(appError('source/not_found', 'source not found', { context: { id: sourceId } }))
    }
    const folder = directoryOf(source.relativePath)
    const showFolder = showFolderOf(source.relativePath)
    const neighbours = sources
      .page({
        libraryId: source.libraryId,
        state: 'ready',
        matchState: 'needs_review',
        limit: neighbourLimit,
      })
      .items.filter(
        (other) =>
          other.id !== source.id &&
          other.rootId === source.rootId &&
          (directoryOf(other.relativePath) === folder ||
            showFolderOf(other.relativePath) === showFolder),
      )
    return ok({
      source,
      library: libraryNamesOf(libraries).get(source.libraryId),
      items: items.linkedItems(source.id).map((item) => itemLabel(item.id)),
      sameFolderToReview: neighbours,
    })
  }
}

export type GetReviewSource = ReturnType<typeof getReviewSourceFactory>
