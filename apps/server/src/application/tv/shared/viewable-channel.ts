import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { TvChannel, TvChannelRepository } from '../../../core/tv/channel.ts'
import type { TvProfileAccess } from '../../../core/tv/viewer.ts'

export type TvChannelNotFound = AppError<'tv/channel_not_found'>

export const tvChannelNotFound = (channelId: string) =>
  err(appError('tv/channel_not_found', 'tv channel not found', { context: { channelId } }))

/**
 * A channel the profile sees (§29.6, §29.7): enabled, present, and the profile has Live TV
 * access; anything else does not exist for it.
 */
export const viewableChannel = (
  {
    tvChannels,
    tvAccess,
  }: {
    tvChannels: Pick<TvChannelRepository, 'findChannel'>
    tvAccess: TvProfileAccess
  },
  { channelId, profileId }: { channelId: string; profileId: string },
): Result<TvChannel, TvChannelNotFound> => {
  const channel = tvChannels.findChannel(channelId)
  return channel !== undefined &&
    channel.enabled &&
    channel.missingSince === undefined &&
    tvAccess.hasLiveTv(profileId)
    ? ok(channel)
    : tvChannelNotFound(channelId)
}
