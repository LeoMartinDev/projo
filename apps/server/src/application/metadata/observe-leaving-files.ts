import type { JobQueue } from '../../core/jobs/ports.ts'
import type { LeavingFiles } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { MetadataRefreshRepository } from '../../core/metadata/editing.ts'
import type { MetadataSettings } from '../../core/metadata/ports.ts'
import { queueRefreshesFactory } from './shared/refresh-jobs.ts'
import { staleTreesFactory } from './shared/stale-metadata.ts'

type Deps = {
  refreshRepository: Pick<MetadataRefreshRepository, 'topLevelWithFiles' | 'treeStates'>
  settings: Pick<MetadataSettings, 'language'>
  jobQueue: JobQueue
  logger: Logger
}

/**
 * Called before files leave their TMDB items; the returned function, called after, queues the
 * refresh of the trees whose deciding library changed (§9.1).
 */
export const observeLeavingFilesFactory = ({
  refreshRepository,
  settings,
  jobQueue,
  logger,
}: Deps) => {
  const queueRefreshes = queueRefreshesFactory({ jobQueue })
  const staleTrees = staleTreesFactory({ refreshRepository, settings })
  return (files: LeavingFiles): (() => number) => {
    const topIds = refreshRepository.topLevelWithFiles(files)
    if (topIds.length === 0) return () => 0
    const before = new Map(
      refreshRepository
        .treeStates({ topIds, serverLanguage: settings.language() })
        .map((state) => [state.topId, state.ratingCountry]),
    )
    return () => {
      const queued = queueRefreshes(staleTrees(topIds, before))
      if (queued > 0)
        logger.info('metadata refresh queued for a new deciding library', { items: queued })
      return queued
    }
  }
}

export type ObserveLeavingFiles = ReturnType<typeof observeLeavingFilesFactory>
