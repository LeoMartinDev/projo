import type { Clock } from '../../core/clock.ts'
import type { TvChannel, TvChannelRepository, TvGroup } from '../../core/tv/channel.ts'
import type { TvGuideRepository, TvNowNext } from '../../core/tv/guide.ts'
import { channelKindOf, type TvProgrammeKind } from '../../core/tv/programme-kind.ts'
import type { TvFavoriteRepository, TvProfileAccess } from '../../core/tv/viewer.ts'

export type TvChannelsView = {
  groups: TvGroup[]
  channels: TvChannel[]
  /** The profile's favourite listed channels, oldest first. */
  favorites: string[]
  /** Now and next of the listed channels that have one (§29.3). */
  guide: ReadonlyMap<string, TvNowNext>
  /** Each listed channel's own kind (§29.3): its group's words, else its name's. */
  kinds: ReadonlyMap<string, TvProgrammeKind>
}

const nothing: TvChannelsView = {
  groups: [],
  channels: [],
  favorites: [],
  guide: new Map(),
  kinds: new Map(),
}

/**
 * The channels a profile sees (§29.7): every enabled, present channel, none without Live TV
 * access (§29.6), with the profile's favourites, the guide's now and next and each channel's
 * kind.
 */
export const listTvChannelsFactory =
  ({
    tvChannels,
    tvAccess,
    favorites,
    guide,
    clock,
  }: {
    tvChannels: Pick<TvChannelRepository, 'listViewable'>
    tvAccess: TvProfileAccess
    favorites: Pick<TvFavoriteRepository, 'listOf'>
    guide: Pick<TvGuideRepository, 'nowAndNext'>
    clock: Clock
  }) =>
  ({ profileId }: { profileId: string }): TvChannelsView => {
    if (!tvAccess.hasLiveTv(profileId)) return nothing
    const { groups, channels } = tvChannels.listViewable()
    const listed = new Set(channels.map((channel) => channel.id))
    const groupNames = new Map(groups.map((group) => [group.id, group.name]))
    return {
      groups,
      channels,
      favorites: favorites.listOf(profileId).filter((id) => listed.has(id)),
      guide: guide.nowAndNext(clock.now()),
      kinds: new Map(
        channels.map((channel) => [
          channel.id,
          channelKindOf({ group: groupNames.get(channel.groupId) ?? '', name: channel.name }),
        ]),
      ),
    }
  }

export type ListTvChannels = ReturnType<typeof listTvChannelsFactory>
