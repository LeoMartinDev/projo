import { ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvFavoriteRepository, TvProfileAccess } from '../../core/tv/viewer.ts'
import { type TvChannelNotFound, viewableChannel } from './shared/viewable-channel.ts'

export type AddTvFavoriteError = TvChannelNotFound

/** Adds a channel the profile sees last among its favourites (§29.7); one already stays put. */
export const addTvFavoriteFactory =
  ({
    tvChannels,
    tvAccess,
    favorites,
    clock,
  }: {
    tvChannels: Pick<TvChannelRepository, 'findChannel'>
    tvAccess: TvProfileAccess
    favorites: Pick<TvFavoriteRepository, 'add'>
    clock: Clock
  }) =>
  ({
    profileId,
    channelId,
  }: {
    profileId: string
    channelId: string
  }): Result<void, AddTvFavoriteError> => {
    const channel = viewableChannel({ tvChannels, tvAccess }, { channelId, profileId })
    if (!channel.ok) return channel
    favorites.add({ profileId, channelId, at: clock.now() })
    return ok()
  }

export type AddTvFavorite = ReturnType<typeof addTvFavoriteFactory>
