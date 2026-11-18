import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'

import type {
  TvChannelDto,
  TvChannelsResponse,
  TvGroupDto,
  TvGuideResponse,
  TvProgrammeDto,
  TvProgrammeKind,
} from '@projo/shared/api/tv'

import { api, request } from '../../shared/api/client.ts'

/** Every TV query of the profile: its channels and its guide. */
export const tvQueryKey = ['catalog', 'tv'] as const

/**
 * The profile's channels (§29.7), in the TV page's order. Under `catalog`: dropped when the
 * profile changes. The shell reads it for its "TV" entry; the page reads it again on opening.
 */
export const tvChannelsQuery = queryOptions({
  queryKey: ['catalog', 'tv', 'channels'],
  queryFn: () => request(() => api.tv.channels.$get()),
  staleTime: 5 * 60_000,
})

/** Every minute (§29.6): the guide's now and next, without reading the channel list again. */
export const guideRefreshMs = 60_000

/** Now and next of the profile's channels (§29.7), read by the TV page and the player. */
export const tvGuideQuery = queryOptions({
  queryKey: ['catalog', 'tv', 'guide'],
  queryFn: () => request(() => api.tv.guide.$get()),
  staleTime: guideRefreshMs / 2,
  refetchInterval: guideRefreshMs,
  refetchOnWindowFocus: 'always',
})

/** A section of the page: the favourites (`group` absent), then the groups. */
export type ChannelSection = {
  id: string
  group?: TvGroupDto
  channels: readonly TvChannelDto[]
}

/** The favourites' ids in their order: the API's list, else the flagged channels (§29.7). */
const favoritesOf = (response: TvChannelsResponse): readonly string[] =>
  response.favorites ??
  response.items.filter((channel) => channel.favorite === true).map((channel) => channel.id)

/**
 * The page's sections (§29.6): the favourites first, in the order they were added, then one per
 * group in the API's order with its channels that are not favourites. A channel comes once; a
 * section without channels is left out.
 */
export const channelSections = (response: TvChannelsResponse): readonly ChannelSection[] => {
  const byId = new Map(response.items.map((channel) => [channel.id, channel]))
  const favorites = favoritesOf(response).flatMap((id) => {
    const channel = byId.get(id)
    return channel === undefined ? [] : [channel]
  })
  const favoriteIds = new Set(favorites.map((channel) => channel.id))
  const byGroup = new Map<string, TvChannelDto[]>()
  for (const channel of response.items) {
    if (favoriteIds.has(channel.id)) continue
    const channels = byGroup.get(channel.groupId)
    if (channels === undefined) byGroup.set(channel.groupId, [channel])
    else channels.push(channel)
  }
  const groups = response.groups.flatMap((group) => {
    const channels = byGroup.get(group.id)
    return channels === undefined ? [] : [{ id: `group:${group.id}`, group, channels }]
  })
  return favorites.length === 0 ? groups : [{ id: 'favorites', channels: favorites }, ...groups]
}

/** The zapping order (§29.5): the channels as the page shows them, section after section. */
export const channelOrder = (response: TvChannelsResponse): readonly string[] =>
  channelSections(response).flatMap((section) => section.channels.map((channel) => channel.id))

/** A programme in full with the next one (§29.7), for its detail dialog. */
export const tvProgrammeQuery = (programmeId: string) =>
  queryOptions({
    queryKey: ['catalog', 'tv', 'programme', programmeId],
    queryFn: () => request(() => api.tv.programmes[':id'].$get({ param: { id: programmeId } })),
    staleTime: guideRefreshMs,
  })

/** The order of the "On now" rows (§29.6). */
export const onNowKinds = [
  'movie',
  'series',
  'sport',
  'news',
  'documentary',
  'kids',
  'entertainment',
  'music',
  'other',
] as const satisfies readonly TvProgrammeKind[]

/** A card of an "On now" row: a channel and its programme on now (none: its name stands in). */
export type OnNowCard = { channel: TvChannelDto; programme?: TvProgrammeDto }

export type OnNowRow = { kind: TvProgrammeKind; cards: readonly OnNowCard[] }

/**
 * The "On now" rows at `at` (§29.6): one per programme kind in `onNowKinds` order, each with the
 * channels whose programme on now has that kind, and the channels without one whose own kind is
 * not `other`, in the page's order; empty rows left out. A server without kinds gives none.
 */
export const onNowRows = (response: TvChannelsResponse, at: number): readonly OnNowRow[] => {
  const byKind = new Map<TvProgrammeKind, OnNowCard[]>()
  const push = (kind: TvProgrammeKind, card: OnNowCard) => {
    const cards = byKind.get(kind)
    if (cards === undefined) byKind.set(kind, [card])
    else cards.push(card)
  }
  for (const section of channelSections(response))
    for (const channel of section.channels) {
      const { now } = onAirAt(channel, at)
      if (now !== undefined) {
        if (now.kind !== undefined) push(now.kind, { channel, programme: now })
      } else if (channel.kind !== undefined && channel.kind !== 'other')
        push(channel.kind, { channel })
    }
  return onNowKinds.flatMap((kind) => {
    const cards = byKind.get(kind)
    return cards === undefined ? [] : [{ kind, cards }]
  })
}

/**
 * The channels with the guide's latest now, next and snapshot (§29.6; the list keeps its own
 * until then).
 */
export const withGuide = (
  response: TvChannelsResponse,
  guide: TvGuideResponse | undefined,
): TvChannelsResponse => {
  if (guide === undefined) return response
  const entries = new Map(guide.items.map((entry) => [entry.channelId, entry]))
  return {
    ...response,
    items: response.items.map(({ now: _now, next: _next, snapshot: _snapshot, ...channel }) => {
      const entry = entries.get(channel.id)
      return {
        ...channel,
        ...(entry?.now === undefined ? {} : { now: entry.now }),
        ...(entry?.next === undefined ? {} : { next: entry.next }),
        ...(entry?.snapshot === undefined ? {} : { snapshot: entry.snapshot }),
      }
    }),
  }
}

export type OnAir = { now?: TvProgrammeDto | undefined; next?: TvProgrammeDto | undefined }

const timeOf = (iso: string) => new Date(iso).getTime()

/**
 * What is on at `at` between two reads of the guide (§29.6): an ended programme gives way to
 * the next one once it has started.
 */
export const onAirAt = (channel: OnAir, at: number): OnAir => {
  const { now, next } = channel
  const nowOn = now !== undefined && timeOf(now.startAt) <= at && timeOf(now.endAt) > at
  if (nowOn) return { now, ...(next === undefined ? {} : { next }) }
  if (next !== undefined && timeOf(next.startAt) <= at && timeOf(next.endAt) > at)
    return { now: next }
  return next !== undefined && timeOf(next.startAt) > at ? { next } : {}
}

/** The elapsed part of a programme at `at`, from 0 to 1. */
export const elapsedOf = (programme: TvProgrammeDto, at: number): number => {
  const start = timeOf(programme.startAt)
  const length = timeOf(programme.endAt) - start
  return length <= 0 ? 1 : Math.min(1, Math.max(0, (at - start) / length))
}

/** The channels once `channelId`'s favourite flag is `favorite` (last among the favourites). */
export const withFavorite = (
  response: TvChannelsResponse,
  channelId: string,
  favorite: boolean,
): TvChannelsResponse => {
  const others = favoritesOf(response).filter((id) => id !== channelId)
  return {
    ...response,
    items: response.items.map((channel) =>
      channel.id === channelId ? { ...channel, favorite } : channel,
    ),
    favorites: favorite ? [...others, channelId] : others,
  }
}

/**
 * `channelId` put back as it was in `before` (its flag and its place among the favourites), every
 * other channel left as `current` has it: a failed star undoes itself only, never a later one.
 */
export const withFavoriteOf = (
  current: TvChannelsResponse,
  before: TvChannelsResponse,
  channelId: string,
): TvChannelsResponse => {
  const previous = favoritesOf(before)
  const index = previous.indexOf(channelId)
  const others = favoritesOf(current).filter((id) => id !== channelId)
  if (index === -1) return withFavorite(current, channelId, false)
  // After the last of the favourites that came before it then and still are.
  const preceding = new Set(previous.slice(0, index))
  const at = others.findLastIndex((id) => preceding.has(id)) + 1
  return {
    ...current,
    items: current.items.map((channel) =>
      channel.id === channelId ? { ...channel, favorite: true } : channel,
    ),
    favorites: [...others.slice(0, at), channelId, ...others.slice(at)],
  }
}

const favoriteMutationKey = [...tvQueryKey, 'favorite'] as const

/**
 * The star of a card (§29.6): moves the channel between the sections at once, put back as it
 * was if the server refuses; the list is read again once the last star in flight settles.
 */
export const useFavoriteToggle = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: favoriteMutationKey,
    mutationFn: ({ channelId, favorite }: { channelId: string; favorite: boolean }) =>
      request(() =>
        favorite
          ? api.tv.channels[':id'].favorite.$put({ param: { id: channelId } })
          : api.tv.channels[':id'].favorite.$delete({ param: { id: channelId } }),
      ),
    onMutate: async ({ channelId, favorite }) => {
      await queryClient.cancelQueries({ queryKey: tvChannelsQuery.queryKey })
      const previous = queryClient.getQueryData(tvChannelsQuery.queryKey)
      if (previous !== undefined)
        queryClient.setQueryData(
          tvChannelsQuery.queryKey,
          withFavorite(previous, channelId, favorite),
        )
      return { previous }
    },
    onError: (_error, { channelId }, context) => {
      const before = context?.previous
      if (before === undefined) return
      queryClient.setQueryData(tvChannelsQuery.queryKey, (current) =>
        current === undefined ? current : withFavoriteOf(current, before, channelId),
      )
    },
    onSettled: async () => {
      // Another star still in flight would be overwritten by a read started now.
      if (queryClient.isMutating({ mutationKey: favoriteMutationKey }) === 1)
        await queryClient.invalidateQueries({ queryKey: tvChannelsQuery.queryKey })
    },
  })
}
