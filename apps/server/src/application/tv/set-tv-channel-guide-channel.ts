import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { TvChannel, TvChannelRepository } from '../../core/tv/channel.ts'
import { queueTvGuide } from './shared/tv-jobs.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel' | 'setGuideChannel'>
  jobQueue: JobQueue
}

export type SetTvChannelGuideChannelError = AppError<'tv/channel_not_found'>

/**
 * The admin's guide channel for a channel (§29.3): it wins over matching and survives refreshes;
 * `''` clears it ("Automatic"). A change queues the source's guide read.
 */
export const setTvChannelGuideChannelFactory =
  ({ tvChannels, jobQueue }: Deps) =>
  ({
    id,
    guideChannel,
  }: {
    id: string
    guideChannel: string
  }): Result<TvChannel, SetTvChannelGuideChannelError> => {
    const channel = tvChannels.findChannel(id)
    if (channel === undefined || channel.missingSince !== undefined)
      return err(appError('tv/channel_not_found', 'tv channel not found', { context: { id } }))
    const chosen = guideChannel.trim()
    if (chosen === (channel.guideChannel ?? '')) return ok(channel)
    tvChannels.setGuideChannel({ id, ...(chosen === '' ? {} : { guideChannel: chosen }) })
    queueTvGuide(jobQueue, channel.sourceId)
    const { guideChannel: _previous, ...rest } = channel
    return ok(chosen === '' ? rest : { ...rest, guideChannel: chosen })
  }

export type SetTvChannelGuideChannel = ReturnType<typeof setTvChannelGuideChannelFactory>
