import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import { everything, type ItemKind, type VisibleItems } from '../../core/catalog/catalog.ts'
import type { MetadataItemRepository } from '../../core/metadata/ports.ts'
import { directoryOf } from '../../core/naming/index.ts'
import { awaitsReview, type ReviewQueue, reviewGroupOf } from '../../core/source/review-groups.ts'
import type { Source, SourceListItem, SourceRepository } from '../../core/source/source.ts'
import { type LibraryNames, libraryNamesOf } from './shared/library-names.ts'

type Deps = {
  sources: Pick<SourceRepository, 'findById' | 'listByIds'>
  reviewQueue: ReviewQueue
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
  /** Its series group (§7.8), first file first: what an identification takes along. */
  seriesGroup: SourceListItem[]
  /** The other files to review of its folder, outside its group. */
  sameFolderToReview: SourceListItem[]
}

export type GetReviewSourceError = AppError<'source/not_found'>

export const getReviewSourceFactory = ({
  sources,
  reviewQueue,
  libraries,
  items,
  visibleItems,
}: Deps) => {
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
    const candidates = reviewQueue.candidates({ libraryId: source.libraryId })
    const group = awaitsReview(source) ? reviewGroupOf(candidates, source.id) : undefined
    const inGroup = new Set([source.id, ...(group?.files.map((file) => file.id) ?? [])])
    const folder = directoryOf(source.relativePath)
    const neighbours = candidates.filter(
      (other) =>
        !inGroup.has(other.id) &&
        other.rootId === source.rootId &&
        directoryOf(other.relativePath) === folder,
    )
    return ok({
      source,
      library: libraryNamesOf(libraries).get(source.libraryId),
      items: items.linkedItems(source.id).map((item) => itemLabel(item.id)),
      seriesGroup: sources.listByIds(group?.files.map((file) => file.id) ?? []),
      sameFolderToReview: sources.listByIds(neighbours.map((other) => other.id)),
    })
  }
}

export type GetReviewSource = ReturnType<typeof getReviewSourceFactory>
