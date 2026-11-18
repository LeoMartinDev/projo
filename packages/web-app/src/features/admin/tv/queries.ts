import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import type {
  AdminTvChannelDto,
  AdminTvChannelsPage,
  CreateTvSourceBody,
  UpdateTvSourceBody,
} from '@projo/shared/api/tv'

import { api, apiPrefix, request } from '../../../shared/api/client.ts'
import { refreshLive } from '../../../shared/api/live-refresh.ts'
import { mediaUrl } from '../../../shared/api/media.ts'
import { useServerEvent } from '../../../shared/events/events.ts'
import { createThrottle } from '../live-scans.ts'

const pageSize = 50

export const tvQueryKey = ['admin', 'tv'] as const
const sourcesQueryKey = [...tvQueryKey, 'sources'] as const
const sourceQueryKey = (id: string) => [...sourcesQueryKey, id] as const
const channelsQueryKey = (sourceId: string) => [...sourceQueryKey(sourceId), 'channels'] as const

export const tvSourcesQuery = queryOptions({
  queryKey: sourcesQueryKey,
  queryFn: () => request(() => api.admin.tv.sources.$get()),
})

/** A source with its groups. */
export const tvSourceQuery = (id: string) =>
  queryOptions({
    queryKey: sourceQueryKey(id),
    queryFn: () => request(() => api.admin.tv.sources[':id'].$get({ param: { id } })),
  })

/** A source's channels in playlist order, 50 at a time: of one group, or matching `q`. */
export const tvChannelsQuery = (sourceId: string, filter: { q: string } | { groupId: string }) =>
  infiniteQueryOptions({
    queryKey: [...channelsQueryKey(sourceId), filter],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(() =>
        api.admin.tv.sources[':id'].channels.$get({
          param: { id: sourceId },
          query: {
            ...filter,
            limit: String(pageSize),
            ...(pageParam === '' ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor,
  })

export const tvLogoUrl = (channelId: string): string =>
  mediaUrl(`${apiPrefix}/tv/channels/${encodeURIComponent(channelId)}/logo`)

const useInvalidateTv = () => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: tvQueryKey })
}

export const useCreateTvSource = () => {
  const invalidate = useInvalidateTv()
  return useMutation({
    mutationFn: (body: CreateTvSourceBody) =>
      request(() => api.admin.tv.sources.$post({ json: body })),
    onSuccess: () => invalidate(),
  })
}

export const useUpdateTvSource = (id: string) => {
  const invalidate = useInvalidateTv()
  return useMutation({
    mutationFn: (body: UpdateTvSourceBody) =>
      request(() => api.admin.tv.sources[':id'].$patch({ param: { id }, json: body })),
    onSuccess: () => invalidate(),
  })
}

export const useRefreshTvSource = (id: string) => {
  const invalidate = useInvalidateTv()
  return useMutation({
    mutationFn: () => request(() => api.admin.tv.sources[':id'].refresh.$post({ param: { id } })),
    onSuccess: () => invalidate(),
  })
}

export const useDeleteTvSource = (id: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => request(() => api.admin.tv.sources[':id'].$delete({ param: { id } })),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: sourceQueryKey(id) })
      void queryClient.invalidateQueries({ queryKey: sourcesQueryKey })
    },
  })
}

/** Enables or disables a group: its channels follow, so every list of the source is refetched. */
export const useSetTvGroupEnabled = (sourceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, enabled }: { groupId: string; enabled: boolean }) =>
      request(() =>
        api.admin.tv.sources[':id'].groups[':groupId'].$patch({
          param: { id: sourceId, groupId },
          json: { enabled },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: tvQueryKey }),
  })
}

const replaceChannel =
  (channel: AdminTvChannelDto) => (data: InfiniteData<AdminTvChannelsPage, string> | undefined) =>
    data === undefined
      ? undefined
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((item) => (item.id === channel.id ? channel : item)),
          })),
        }

/** Enables or disables a channel: updated in place in the loaded lists, counts refetched. */
export const useSetTvChannelEnabled = (sourceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ channelId, enabled }: { channelId: string; enabled: boolean }) =>
      request(() =>
        api.admin.tv.channels[':id'].$patch({ param: { id: channelId }, json: { enabled } }),
      ),
    onSuccess: (channel) => {
      queryClient.setQueriesData<InfiniteData<AdminTvChannelsPage, string>>(
        { queryKey: channelsQueryKey(sourceId) },
        replaceChannel(channel),
      )
      void queryClient.invalidateQueries({ queryKey: sourceQueryKey(sourceId), exact: true })
      void queryClient.invalidateQueries({ queryKey: sourcesQueryKey, exact: true })
    },
  })
}

/** The guide channels of a source's last guide read (§29.3), 50 at a time, matching `q`. */
export const tvGuideChannelsQuery = (sourceId: string, q: string) =>
  infiniteQueryOptions({
    queryKey: [...sourceQueryKey(sourceId), 'guide-channels', q],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      request(() =>
        api.admin.tv.sources[':id']['guide-channels'].$get({
          param: { id: sourceId },
          query: {
            ...(q === '' ? {} : { q }),
            limit: String(pageSize),
            ...(pageParam === '' ? {} : { cursor: pageParam }),
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor,
  })

/**
 * Sets a channel's guide channel, or `''` for "Automatic" (§29.3): the loaded lists are read
 * again (the server queues the guide's read, which records what matched).
 */
export const useSetTvChannelGuideChannel = (sourceId: string) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ channelId, guideChannel }: { channelId: string; guideChannel: string }) =>
      request(() =>
        api.admin.tv.channels[':id'].$patch({ param: { id: channelId }, json: { guideChannel } }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: channelsQueryKey(sourceId) }),
  })
}

const liveJobTypes: ReadonlySet<string> = new Set([
  'refresh_tv_source',
  'fetch_tv_logos',
  'refresh_tv_guide',
])

/** Follows the refresh and logo jobs (§29.6): the sources, groups and loaded lists. */
export const useLiveTv = () => {
  const queryClient = useQueryClient()
  const [throttle] = useState(() =>
    createThrottle(() => refreshLive(queryClient, tvQueryKey), 2000),
  )
  useEffect(() => () => throttle.cancel(), [throttle])
  useServerEvent('job.updated', (job) => {
    if (liveJobTypes.has(job.type)) throttle.trigger()
  })
}
