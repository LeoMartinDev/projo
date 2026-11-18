import { queryOptions } from '@tanstack/react-query'

import type { TvChannelDto, TvChannelsResponse, TvGroupDto } from '@projo/shared/api/tv'

import { api, request } from '../../shared/api/client.ts'

/**
 * The profile's channels (§29.7), in the TV page's order. Under `catalog`: dropped when the
 * profile changes. The shell reads it for its "TV" entry; the page reads it again on opening.
 */
export const tvChannelsQuery = queryOptions({
  queryKey: ['catalog', 'tv', 'channels'],
  queryFn: () => request(() => api.tv.channels.$get()),
  staleTime: 5 * 60_000,
})

export type ChannelSection = { group: TvGroupDto; channels: readonly TvChannelDto[] }

/** The page's sections: one per group, in the API's order, each with its channels in order. */
export const channelSections = (response: TvChannelsResponse): readonly ChannelSection[] => {
  const byGroup = new Map<string, TvChannelDto[]>()
  for (const channel of response.items) {
    const channels = byGroup.get(channel.groupId)
    if (channels === undefined) byGroup.set(channel.groupId, [channel])
    else channels.push(channel)
  }
  return response.groups.flatMap((group) => {
    const channels = byGroup.get(group.id)
    return channels === undefined ? [] : [{ group, channels }]
  })
}

/** The zapping order (§29.5): the channels as the page shows them, section after section. */
export const channelOrder = (response: TvChannelsResponse): readonly string[] =>
  channelSections(response).flatMap((section) => section.channels.map((channel) => channel.id))
