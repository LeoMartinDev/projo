import type { MetadataItemRepository } from '../../../core/metadata/ports.ts'
import type { SourceRepository } from '../../../core/source/source.ts'

type Deps = {
  items: Pick<MetadataItemRepository, 'replaceLinks'>
  sourceRepository: Pick<SourceRepository, 'patch'>
}

/**
 * Hides a file (§7.8): rejected, out of its items (an item left without a file becomes
 * invisible). Run inside the caller's transaction, between `observeLeavingFiles` and its settle.
 */
export const hideSourceFactory =
  ({ items, sourceRepository }: Deps) =>
  (sourceId: string): void => {
    sourceRepository.patch(sourceId, {
      state: 'rejected',
      matchState: 'unmatched',
      reviewReason: undefined,
    })
    items.replaceLinks({ sourceId, itemIds: [] })
  }

export type HideSource = ReturnType<typeof hideSourceFactory>
