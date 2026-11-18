import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository, TvGroupSummary } from '../../core/tv/channel.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'
import { queueTvGuide, queueTvLogos } from './shared/tv-jobs.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  tvChannels: Pick<TvChannelRepository, 'findGroup' | 'setGroupEnabled'>
  jobQueue: JobQueue
  logger: Logger
}

export type SetTvGroupEnabledError = AppError<'tv/source_not_found' | 'tv/group_not_found'>

/**
 * Enables or disables a group: its flag (the state of the channels it gains later) and every
 * one of its channels (§29.2). Enabling queues the download of their logos.
 */
export const setTvGroupEnabledFactory =
  ({ tvSources, tvChannels, jobQueue, logger }: Deps) =>
  ({
    sourceId,
    groupId,
    enabled,
  }: {
    sourceId: string
    groupId: string
    enabled: boolean
  }): Result<TvGroupSummary, SetTvGroupEnabledError> => {
    if (tvSources.findById(sourceId) === undefined)
      return err(
        appError('tv/source_not_found', 'tv source not found', { context: { id: sourceId } }),
      )
    if (tvChannels.findGroup(groupId)?.sourceId !== sourceId)
      return err(appError('tv/group_not_found', 'tv group not found', { context: { id: groupId } }))
    tvChannels.setGroupEnabled({ id: groupId, enabled })
    if (enabled) {
      queueTvLogos(jobQueue, sourceId)
      queueTvGuide(jobQueue, sourceId)
    }
    logger.info('tv group switched', { tvSourceId: sourceId, tvGroupId: groupId, enabled })
    const updated = tvChannels.findGroup(groupId)
    if (updated === undefined) throw new Error(`tv group vanished: ${groupId}`)
    return ok(updated)
  }

export type SetTvGroupEnabled = ReturnType<typeof setTvGroupEnabledFactory>
