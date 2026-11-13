import type { LibraryMetadataContextObserver } from '../../../core/library/library.ts'
import type { Logger } from '../../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../../core/playback/session.ts'
import type { MissingSourceRepository } from '../../../core/source/source.ts'

export type MissingSourcePurgeDeps = {
  missingSources: MissingSourceRepository
  playbackSessions: PlaybackSessionTerminator
  metadataContext: Pick<LibraryMetadataContextObserver, 'filesLeaving'>
  logger: Logger
}

/** Purges missing sources: their sessions end, the metadata domain sees the files leave. */
export const purgeSources = (
  { missingSources, playbackSessions, metadataContext, logger }: MissingSourcePurgeDeps,
  sourceIds: string[],
): number => {
  if (sourceIds.length === 0) return 0
  const settle = metadataContext.filesLeaving({ sourceIds })
  playbackSessions.endWithin({ sourceIds })
  const { purged, deletedItems } = missingSources.purge(sourceIds)
  settle()
  logger.info('missing sources purged', { purged, deletedItems })
  return purged
}
