import type { TvProfileAccess } from '../../core/tv/viewer.ts'
import type { VisibleChannels } from './visible-channels.ts'

/**
 * A TV page's hint (§29.4): the channels it shows in its viewport. Nothing from a profile
 * without Live TV access; any other id is only a hint (a channel that is not enabled is never
 * grabbed).
 */
export const recordVisibleChannelsFactory =
  ({
    tvAccess,
    visibleChannels,
  }: {
    tvAccess: TvProfileAccess
    visibleChannels: Pick<VisibleChannels, 'record'>
  }) =>
  ({ profileId, channelIds }: { profileId: string; channelIds: readonly string[] }): void => {
    if (!tvAccess.hasLiveTv(profileId)) return
    visibleChannels.record({ profileId, channelIds })
  }

export type RecordVisibleChannels = ReturnType<typeof recordVisibleChannelsFactory>
