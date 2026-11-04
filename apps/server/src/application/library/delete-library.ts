import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { JobControl } from '../../core/jobs/ports.ts'
import type {
  LibraryLeftovers,
  LibraryMetadataContextObserver,
  LibraryRepository,
} from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { LocalItemRepository } from '../../core/scanner/item-linking.ts'

type Deps = {
  libraryRepository: LibraryRepository
  localItems: Pick<LocalItemRepository, 'itemIdsOfLibrary' | 'pruneOrphans'>
  playbackSessions: PlaybackSessionTerminator
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  leftovers: LibraryLeftovers
  jobControl: Pick<JobControl, 'cancel'>
  logger: Logger
}

export const deleteLibraryFactory =
  ({
    libraryRepository,
    localItems,
    playbackSessions,
    metadataContext,
    leftovers,
    jobControl,
    logger,
  }: Deps) =>
  async ({ id }: { id: string }): Promise<Result<void, AppError<'library/not_found'>>> => {
    const library = libraryRepository.findById(id)
    if (library === undefined) {
      return err(appError('library/not_found', 'library not found', { context: { id } }))
    }
    const itemIds = localItems.itemIdsOfLibrary(id)
    const settle = metadataContext.filesLeaving({ libraryId: id })
    const { runningJobIds } = leftovers.clear({ libraryId: id })
    for (const jobId of runningJobIds) jobControl.cancel(jobId)
    playbackSessions.endWithin({ libraryId: id })
    libraryRepository.delete(id)
    localItems.pruneOrphans(itemIds, (pruned) => playbackSessions.endWithin({ itemIds: pruned }))
    settle()
    logger.info('library deleted', { libraryId: id, cancelledJobs: runningJobIds.length })
    return ok()
  }
