import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import { queueRefreshesFactory } from './shared/refresh-jobs.ts'

type Deps = {
  refreshRepository: Pick<MetadataRefreshRepository, 'identifiedTopLevel'>
  jobQueue: JobQueue
  logger: Logger
}

/** The library half of `refresh_metadata`: one refresh job per identified top-level item. */
export const refreshLibraryMetadataFactory = ({ refreshRepository, jobQueue, logger }: Deps) => {
  const queueRefreshes = queueRefreshesFactory({ jobQueue })
  return ({ libraryId }: { libraryId: string }): number => {
    const queued = queueRefreshes(refreshRepository.identifiedTopLevel(libraryId))
    logger.info('library metadata refresh queued', { libraryId, items: queued })
    return queued
  }
}

export type RefreshLibraryMetadata = ReturnType<typeof refreshLibraryMetadataFactory>
