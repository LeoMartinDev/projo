import { ok, type Result } from '@projo/shared'

import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvFavoriteRepository, TvProfileAccess } from '../../core/tv/viewer.ts'
import { type TvChannelNotFound, viewableChannel } from './shared/viewable-channel.ts'

export type RemoveTvFavoriteError = TvChannelNotFound

/** Removes a channel the profile sees from its favourites (§29.7); not one is fine too. */
export const removeTvFavoriteFactory =
  ({
    tvChannels,
    tvAccess,
    favorites,
  }: {
    tvChannels: Pick<TvChannelRepository, 'findChannel'>
    tvAccess: TvProfileAccess
    favorites: Pick<TvFavoriteRepository, 'remove'>
  }) =>
  ({
    profileId,
    channelId,
  }: {
    profileId: string
    channelId: string
  }): Result<void, RemoveTvFavoriteError> => {
    const channel = viewableChannel({ tvChannels, tvAccess }, { channelId, profileId })
    if (!channel.ok) return channel
    favorites.remove({ profileId, channelId })
    return ok()
  }

export type RemoveTvFavorite = ReturnType<typeof removeTvFavoriteFactory>
