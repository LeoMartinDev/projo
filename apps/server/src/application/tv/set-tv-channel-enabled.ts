import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { TvChannel, TvChannelRepository } from '../../core/tv/channel.ts'
import { queueTvLogos } from './shared/tv-jobs.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel' | 'setChannelEnabled'>
  jobQueue: JobQueue
}

export type SetTvChannelEnabledError = AppError<'tv/channel_not_found'>

/** Enables or disables one channel, leaving its group's flag as it is (§29.2). */
export const setTvChannelEnabledFactory =
  ({ tvChannels, jobQueue }: Deps) =>
  ({
    id,
    enabled,
  }: {
    id: string
    enabled: boolean
  }): Result<TvChannel, SetTvChannelEnabledError> => {
    const channel = tvChannels.findChannel(id)
    if (channel === undefined || channel.missingSince !== undefined)
      return err(appError('tv/channel_not_found', 'tv channel not found', { context: { id } }))
    tvChannels.setChannelEnabled({ id, enabled })
    if (enabled) queueTvLogos(jobQueue, channel.sourceId)
    return ok({ ...channel, enabled })
  }

export type SetTvChannelEnabled = ReturnType<typeof setTvChannelEnabledFactory>
