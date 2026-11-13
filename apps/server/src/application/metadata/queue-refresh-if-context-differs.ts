import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import type { MetadataSettings } from '../../core/metadata/ports.ts'
import { refreshContextFactory } from './shared/refresh-context.ts'
import { queueRefreshesFactory } from './shared/refresh-jobs.ts'
import { staleTreesFactory } from './shared/stale-metadata.ts'

type Deps = {
  refreshRepository: Pick<MetadataRefreshRepository, 'libraryOf' | 'treeStates'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  logger: Logger
}

export const queueRefreshIfContextDiffersFactory = ({
  refreshRepository,
  settings,
  jobQueue,
  logger,
}: Deps) => {
  const contextOf = refreshContextFactory({ refreshRepository, settings })
  const queueRefreshes = queueRefreshesFactory({ jobQueue })
  const staleTrees = staleTreesFactory({ refreshRepository, settings })
  return ({
    itemId,
    language,
    ratingCountry,
  }: {
    itemId: string
    language: string
    ratingCountry: string
  }): boolean => {
    const context = contextOf(itemId)
    const differs = context.language !== language || context.ratingCountry !== ratingCountry
    if (!differs && staleTrees([itemId]).length === 0) return false
    queueRefreshes([itemId])
    logger.info('metadata refresh queued for the deciding library', { itemId })
    return true
  }
}

export type QueueRefreshIfContextDiffers = ReturnType<typeof queueRefreshIfContextDiffersFactory>
