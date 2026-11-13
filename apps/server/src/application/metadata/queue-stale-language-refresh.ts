import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import type { MetadataSettings } from '../../core/metadata/ports.ts'
import { queueRefreshesFactory } from './shared/refresh-jobs.ts'
import { staleLanguageFactory } from './shared/stale-metadata.ts'

type Deps = {
  refreshRepository: Pick<MetadataRefreshRepository, 'staleLanguage'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  logger: Logger
}

export const queueStaleLanguageRefreshFactory = ({
  refreshRepository,
  settings,
  jobQueue,
  logger,
}: Deps) => {
  const queueRefreshes = queueRefreshesFactory({ jobQueue })
  const staleLanguage = staleLanguageFactory({ refreshRepository, settings })
  return (): number => {
    const queued = queueRefreshes(staleLanguage())
    logger.info('stale metadata language refresh queued', { items: queued })
    return queued
  }
}

export type QueueStaleLanguageRefresh = ReturnType<typeof queueStaleLanguageRefreshFactory>
