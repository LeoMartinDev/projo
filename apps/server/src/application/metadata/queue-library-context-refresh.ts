import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import type { MetadataSettings } from '../../core/metadata/ports.ts'
import { queueRefreshesFactory } from './shared/refresh-jobs.ts'
import { staleLanguageFactory } from './shared/stale-metadata.ts'

type Deps = {
  refreshRepository: Pick<MetadataRefreshRepository, 'staleLanguage' | 'decidedBy'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  logger: Logger
}

export const queueLibraryContextRefreshFactory = ({
  refreshRepository,
  settings,
  jobQueue,
  logger,
}: Deps) => {
  const queueRefreshes = queueRefreshesFactory({ jobQueue })
  const staleLanguage = staleLanguageFactory({ refreshRepository, settings })
  return ({
    libraryId,
    language,
    ratingCountry,
  }: {
    libraryId: string
    language: boolean
    ratingCountry: boolean
  }): number => {
    const itemIds = new Set([
      ...(language ? staleLanguage(libraryId) : []),
      ...(ratingCountry ? refreshRepository.decidedBy(libraryId) : []),
    ])
    const queued = queueRefreshes([...itemIds].sort())
    logger.info('library metadata context refresh queued', { libraryId, items: queued })
    return queued
  }
}

export type QueueLibraryContextRefresh = ReturnType<typeof queueLibraryContextRefreshFactory>
