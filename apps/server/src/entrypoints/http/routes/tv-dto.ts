import type {
  AdminTvChannelDto,
  AdminTvSessionDto,
  AdminTvGroupDto,
  AdminTvSourceDetailDto,
  AdminTvSourceDto,
  TvChannelsResponse,
  TvGuideResponse,
  TvProgrammeDto,
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
import type { TvChannelsView } from '../../../application/tv/list-tv-channels.ts'
import type { TvChannel, TvGroupSummary } from '../../../core/tv/channel.ts'
import type { TvNowNext, TvProgramme } from '../../../core/tv/guide.ts'
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

export const toTvSourceSettingsDto = (settings: TvSourceSettings): TvSourceSettingsDto =>
  settings.kind === 'freebox'
    ? { kind: 'freebox', address: settings.address }
    : {
        kind: settings.kind,
        playlistUrl: maskUrl(settings.playlistUrl),
        ...(settings.guideUrl === undefined ? {} : { guideUrl: maskUrl(settings.guideUrl) }),
        ...(settings.userAgent === undefined ? {} : { userAgent: settings.userAgent }),
      }

/** The settings of a `POST /admin/tv/sources` body. */
export const toTvSourceSettings = (input: TvSourceSettingsInput): TvSourceSettings =>
  input.kind === 'freebox'
    ? { kind: 'freebox', address: input.address }
    : {
        kind: input.kind,
        playlistUrl: input.playlistUrl,
        ...(input.guideUrl === undefined ? {} : { guideUrl: input.guideUrl }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
      }

/** The settings of a `PATCH /admin/tv/sources/:id` body. */
export const toTvSourceSettingsPatch = (
  input: TvSourceSettingsPatchInput,
): TvSourceSettingsPatch =>
  input.kind === 'freebox'
    ? { kind: 'freebox', ...(input.address === undefined ? {} : { address: input.address }) }
    : {
        kind: input.kind,
        ...(input.playlistUrl === undefined ? {} : { playlistUrl: input.playlistUrl }),
        ...(input.guideUrl === undefined ? {} : { guideUrl: input.guideUrl }),
        ...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
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

export const toAdminTvChannelDto = (channel: TvChannel): AdminTvChannelDto => ({
  id: channel.id,
  name: channel.name,
  ...(channel.number === undefined ? {} : { number: channel.number }),
  groupId: channel.groupId,
  enabled: channel.enabled,
  hasLogo: channel.logoPath !== undefined,
})

const apiPrefix = '/api/v1'

const toTvProgrammeDto = (programme: TvProgramme): TvProgrammeDto => ({
  title: programme.title,
  startAt: programme.startAt.toISOString(),
  endAt: programme.endAt.toISOString(),
})

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

/** The live playlist's capability URL (§20, §29.4). */
export const liveStreamUrlOf = (created: CreatedLiveSession): string =>
  `${apiPrefix}/stream/${encodeURIComponent(created.session.id)}/${encodeURIComponent(created.streamSecret)}/live/index.m3u8`

export const toTvSessionDto = (created: CreatedLiveSession): TvSessionDto => ({
  sessionId: created.session.id,
  streamUrl: liveStreamUrlOf(created),
  rendition: created.session.rendition,
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
})
