import type { TvSourceState } from '@projo/shared/api/tv'

import type { TvChannelCounts, TvGroupSummary } from '../../../core/tv/channel.ts'
import type { TvSource } from '../../../core/tv/source.ts'

export type TvSourceView = TvSource & TvChannelCounts & { state: TvSourceState }

export type TvSourceDetailView = TvSourceView & { groups: TvGroupSummary[] }

/** State of a source as Admin → TV shows it (§29.6). */
export const tvSourceStateOf = (source: TvSource, refreshing: boolean): TvSourceState => {
  if (refreshing) return 'refreshing'
  if (source.lastError !== undefined) return 'error'
  return source.lastRefreshAt === undefined ? 'pending' : 'ready'
}

const noChannels: TvChannelCounts = { channelCount: 0, enabledChannelCount: 0 }

export const toTvSourceView = ({
  source,
  counts = noChannels,
  refreshing,
}: {
  source: TvSource
  counts: TvChannelCounts | undefined
  refreshing: boolean
}): TvSourceView => ({
  ...source,
  channelCount: counts.channelCount,
  enabledChannelCount: counts.enabledChannelCount,
  state: tvSourceStateOf(source, refreshing),
})
