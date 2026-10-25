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
  /** §9.1: a movie or series it decided, still in another library, is refreshed there. */
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  leftovers: LibraryLeftovers
  /** Aborts the running jobs on the library (a scan walking it, a probe on one of its files). */
  jobControl: Pick<JobControl, 'cancel'>
  logger: Logger
}

/**
 * Deletes a library, its roots, sources and scan runs (cascade). Files are never touched. Local
 * items left without any source are pruned; items carrying a TMDB id stay (invisible). Playback
 * sessions on them are ended first: the cascade would drop their rows under a running ffmpeg.
 * Its queued jobs go, its running ones are cancelled, its open notifications are resolved.
 */
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
    // Before the cascade: the jobs on its sources are found through the `sources` rows.
    const { runningJobIds } = leftovers.clear({ libraryId: id })
    for (const jobId of runningJobIds) jobControl.cancel(jobId)
    playbackSessions.endWithin({ libraryId: id })
    libraryRepository.delete(id)
    localItems.pruneOrphans(itemIds, (pruned) => playbackSessions.endWithin({ itemIds: pruned }))
    settle()
    logger.info('library deleted', { libraryId: id, cancelledJobs: runningJobIds.length })
    return ok()
  }
