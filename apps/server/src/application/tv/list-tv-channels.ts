import type { TvChannel, TvChannelRepository, TvGroup } from '../../core/tv/channel.ts'

export type TvChannelsView = { groups: TvGroup[]; channels: TvChannel[] }

/**
 * The channels a viewer sees (§29.7): every enabled, present channel, to every profile until the
 * guide slice brings the per-profile switch.
 */
export const listTvChannelsFactory =
  ({ tvChannels }: { tvChannels: Pick<TvChannelRepository, 'listViewable'> }) =>
  (): TvChannelsView =>
    tvChannels.listViewable()

export type ListTvChannels = ReturnType<typeof listTvChannelsFactory>
