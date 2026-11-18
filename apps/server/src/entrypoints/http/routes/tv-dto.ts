import type {
  AdminTvChannelDto,
  AdminTvGuideMatchDto,
  AdminTvSessionDto,
  AdminTvGroupDto,
  AdminTvSourceDetailDto,
  AdminTvSourceDto,
  TvChannelsResponse,
  TvEpisodeDto,
  TvGuideResponse,
  TvProgrammeDetailDto,
  TvProgrammeDto,
  TvScheduleResponse,
  TvSessionDto,
  TvSourceSettingsDto,
  TvSourceSettingsInput,
  TvSourceSettingsPatch as TvSourceSettingsPatchInput,
} from '@projo/shared/api/tv'

import type {
  TvSourceDetailView,
  TvSourceView,
} from '../../../application/tv/shared/tv-source-view.ts'
import type { CreatedLiveSession } from '../../../application/tv/create-live-session.ts'
import type { TvProgrammeView } from '../../../application/tv/get-tv-programme.ts'
import type { TvChannelsView } from '../../../application/tv/list-tv-channels.ts'
import type { TvScheduleEntry } from '../../../application/tv/list-tv-schedule.ts'
import type { TvChannel, TvGroupSummary } from '../../../core/tv/channel.ts'
import type { TvEpisode, TvGuideChannel, TvNowNext, TvProgramme } from '../../../core/tv/guide.ts'
import type { ActiveLiveSessionView } from '../../../core/tv/live-session.ts'
import type { TvSourceSettings, TvSourceSettingsPatch } from '../../../core/tv/source.ts'

/**
 * A URL as the admin API shows it (§29.7): `<scheme>://<host>[:port]/…`, never its user info,
 * path or query, which carry the provider's secrets.
 */
export const maskUrl = (url: string): string => {
  if (!URL.canParse(url)) return '…'
  const { protocol, host } = new URL(url)
  return `${protocol}//${host}/…`
}

/** An Xtream panel's origin (§29.7): its URL holds no path, its credentials are never shown. */
const originOf = (url: string): string => (URL.canParse(url) ? new URL(url).origin : '…')

export const toTvSourceSettingsDto = (settings: TvSourceSettings): TvSourceSettingsDto => {
  switch (settings.kind) {
    case 'freebox':
      return { kind: 'freebox', address: settings.address }
    case 'xtream':
      return { kind: 'xtream', serverUrl: originOf(settings.serverUrl) }
    case 'm3u':
      return {
        kind: 'm3u',
        playlistUrl: maskUrl(settings.playlistUrl),
        ...(settings.guideUrl === undefined ? {} : { guideUrl: maskUrl(settings.guideUrl) }),
        ...(settings.userAgent === undefined ? {} : { userAgent: settings.userAgent }),
      }
  }
}

/** The settings of a `POST /admin/tv/sources` body. */
export const toTvSourceSettings = (input: TvSourceSettingsInput): TvSourceSettings => {
  switch (input.kind) {
    case 'freebox':
      return { kind: 'freebox', address: input.address }
    case 'xtream':
      return {
        kind: 'xtream',
        serverUrl: input.serverUrl,
        username: input.username,
        password: input.password,
      }
    case 'm3u':
      return {
        kind: 'm3u',
        playlistUrl: input.playlistUrl,
        ...(input.guideUrl === undefined ? {} : { guideUrl: input.guideUrl }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      }
  }
}

/** The settings of a `PATCH /admin/tv/sources/:id` body. */
export const toTvSourceSettingsPatch = (
  input: TvSourceSettingsPatchInput,
): TvSourceSettingsPatch => {
  switch (input.kind) {
    case 'freebox':
      return { kind: 'freebox', ...(input.address === undefined ? {} : { address: input.address }) }
    case 'xtream':
      return {
        kind: 'xtream',
        ...(input.serverUrl === undefined ? {} : { serverUrl: input.serverUrl }),
        ...(input.username === undefined ? {} : { username: input.username }),
        ...(input.password === undefined ? {} : { password: input.password }),
      }
    case 'm3u':
      return {
        kind: 'm3u',
        ...(input.playlistUrl === undefined ? {} : { playlistUrl: input.playlistUrl }),
        ...(input.guideUrl === undefined ? {} : { guideUrl: input.guideUrl }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      }
  }
}

export const toAdminTvSourceDto = (view: TvSourceView): AdminTvSourceDto => ({
  id: view.id,
  name: view.name,
  kind: view.settings.kind,
  settings: toTvSourceSettingsDto(view.settings),
  ...(view.maxConnections === undefined ? {} : { maxConnections: view.maxConnections }),
  channelCount: view.channelCount,
  enabledChannelCount: view.enabledChannelCount,
  state: view.state,
  ...(view.lastRefreshAt === undefined ? {} : { lastRefreshAt: view.lastRefreshAt.toISOString() }),
  ...(view.lastAttemptAt === undefined ? {} : { lastAttemptAt: view.lastAttemptAt.toISOString() }),
  ...(view.lastError === undefined ? {} : { lastError: view.lastError }),
  failureCount: view.failureCount,
  createdAt: view.createdAt.toISOString(),
})

export const toAdminTvGroupDto = (group: TvGroupSummary): AdminTvGroupDto => ({
  id: group.id,
  name: group.name,
  enabled: group.enabled,
  channelCount: group.channelCount,
  enabledChannelCount: group.enabledChannelCount,
})

export const toAdminTvSourceDetailDto = (view: TvSourceDetailView): AdminTvSourceDetailDto => ({
  ...toAdminTvSourceDto(view),
  groups: view.groups.map(toAdminTvGroupDto),
})

/** The guide channel a channel's programmes come from (§29.7), named when the last read listed it. */
const guideMatchOf = (
  channel: TvChannel,
  guideChannels: ReadonlyMap<string, TvGuideChannel>,
): AdminTvGuideMatchDto | undefined => {
  const manual = channel.guideChannel !== undefined
  const id = channel.guideChannel ?? channel.guideMatched
  if (id === undefined || id === '') return undefined
  const name = guideChannels.get(id.toLowerCase())?.names[0]
  return { id, ...(name === undefined ? {} : { name }), manual }
}

export const toAdminTvChannelDto = (
  channel: TvChannel,
  guideChannels: ReadonlyMap<string, TvGuideChannel> = new Map(),
): AdminTvChannelDto => {
  const guideChannel = guideMatchOf(channel, guideChannels)
  return {
    id: channel.id,
    name: channel.name,
    ...(channel.number === undefined ? {} : { number: channel.number }),
    groupId: channel.groupId,
    enabled: channel.enabled,
    hasLogo: channel.logoPath !== undefined,
    ...(guideChannel === undefined ? {} : { guideChannel }),
    ...(channel.guideMatched === undefined ? {} : { guideMatched: channel.guideMatched !== '' }),
  }
}

const apiPrefix = '/api/v1'

const programmeImageUrlOf = (programme: TvProgramme): string | undefined =>
  programme.imageStored
    ? `${apiPrefix}/tv/programmes/${encodeURIComponent(programme.id)}/image`
    : undefined

const toTvEpisodeDto = (episode: TvEpisode | undefined): TvEpisodeDto | undefined => {
  if (episode === undefined) return undefined
  const { season, episode: number, label } = episode
  if (season !== undefined || number !== undefined)
    return {
      ...(season === undefined ? {} : { season }),
      ...(number === undefined ? {} : { episode: number }),
    }
  return label === undefined ? undefined : { label }
}

const toTvProgrammeDto = (programme: TvProgramme): TvProgrammeDto => {
  const episode = toTvEpisodeDto(programme.episode)
  const imageUrl = programmeImageUrlOf(programme)
  return {
    id: programme.id,
    title: programme.title,
    ...(programme.subtitle === undefined ? {} : { subtitle: programme.subtitle }),
    ...(episode === undefined ? {} : { episode }),
    kind: programme.kind,
    ...(imageUrl === undefined ? {} : { imageUrl }),
    startAt: programme.startAt.toISOString(),
    endAt: programme.endAt.toISOString(),
  }
}

/** `GET /tv/programmes/:id` (§29.7). */
export const toTvProgrammeDetailDto = ({
  programme,
  next,
}: TvProgrammeView): TvProgrammeDetailDto => {
  const episode = toTvEpisodeDto(programme.episode)
  const imageUrl = programmeImageUrlOf(programme)
  return {
    id: programme.id,
    channelId: programme.channelId,
    title: programme.title,
    ...(programme.subtitle === undefined ? {} : { subtitle: programme.subtitle }),
    ...(programme.description === undefined ? {} : { description: programme.description }),
    ...(episode === undefined ? {} : { episode }),
    kind: programme.kind,
    categories: programme.categories.map((category) => category.text),
    startAt: programme.startAt.toISOString(),
    endAt: programme.endAt.toISOString(),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    ...(next === undefined ? {} : { next: toTvProgrammeDto(next) }),
  }
}

const nowNextFields = (entry: TvNowNext | undefined) => ({
  ...(entry?.now === undefined ? {} : { now: toTvProgrammeDto(entry.now) }),
  ...(entry?.next === undefined ? {} : { next: toTvProgrammeDto(entry.next) }),
})

/** The channels a viewer sees (§29.7), with favourites and the guide's now and next. */
export const toTvChannelsResponse = (view: TvChannelsView): TvChannelsResponse => {
  const favorites = new Set(view.favorites)
  return {
    groups: view.groups.map((group) => ({ id: group.id, name: group.name })),
    items: view.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      ...(channel.number === undefined ? {} : { number: channel.number }),
      groupId: channel.groupId,
      ...(channel.logoPath === undefined
        ? {}
        : { logoUrl: `${apiPrefix}/tv/channels/${encodeURIComponent(channel.id)}/logo` }),
      kind: view.kinds.get(channel.id) ?? 'other',
      favorite: favorites.has(channel.id),
      ...nowNextFields(view.guide.get(channel.id)),
    })),
    favorites: view.favorites,
  }
}

/** Now and next of the listed channels (§29.7). */
export const toTvGuideResponse = (guide: ReadonlyMap<string, TvNowNext>): TvGuideResponse => ({
  items: [...guide.entries()].map(([channelId, entry]) => ({
    channelId,
    ...nowNextFields(entry),
  })),
})

/** The guide grid's programmes (§29.7): compact, without texts nor images. */
export const toTvScheduleResponse = (entries: readonly TvScheduleEntry[]): TvScheduleResponse => ({
  items: entries.map(({ channelId, programmes }) => ({
    channelId,
    programmes: programmes.map((programme) => {
      const episode = toTvEpisodeDto(programme.episode)
      return {
        id: programme.id,
        title: programme.title,
        startAt: programme.startAt.toISOString(),
        endAt: programme.endAt.toISOString(),
        kind: programme.kind,
        ...(episode === undefined ? {} : { episode }),
      }
    }),
  })),
})

/** The live playlist's capability URL (§20, §29.4). */
export const liveStreamUrlOf = (created: CreatedLiveSession): string =>
  `${apiPrefix}/stream/${encodeURIComponent(created.session.id)}/${encodeURIComponent(created.streamSecret)}/live/index.m3u8`

export const toTvSessionDto = (created: CreatedLiveSession): TvSessionDto => ({
  sessionId: created.session.id,
  streamUrl: liveStreamUrlOf(created),
  rendition: created.session.rendition,
  windowS: created.windowS,
})

export const toAdminTvSessionDto = (view: ActiveLiveSessionView): AdminTvSessionDto => ({
  id: view.id,
  account: view.account,
  profile: view.profile,
  channel: view.channel,
  rendition: view.rendition,
  ...(view.device === undefined ? {} : { device: view.device }),
  startedAt: view.startedAt.toISOString(),
  lastHeartbeatAt: view.lastHeartbeatAt.toISOString(),
  ...(view.pausedSince === undefined ? {} : { pausedSince: view.pausedSince.toISOString() }),
})
