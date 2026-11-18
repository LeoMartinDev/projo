import type {
  AdminTvChannelDto,
  AdminTvSessionDto,
  AdminTvGroupDto,
  AdminTvSourceDetailDto,
  AdminTvSourceDto,
  TvChannelsResponse,
  TvSessionDto,
  TvSourceSettingsDto,
} from '@projo/shared/api/tv'

import type {
  TvSourceDetailView,
  TvSourceView,
} from '../../../application/tv/shared/tv-source-view.ts'
import type { CreatedLiveSession } from '../../../application/tv/create-live-session.ts'
import type { TvChannelsView } from '../../../application/tv/list-tv-channels.ts'
import type { TvChannel, TvGroupSummary } from '../../../core/tv/channel.ts'
import type { ActiveLiveSessionView } from '../../../core/tv/live-session.ts'
import type { TvSourceSettings } from '../../../core/tv/source.ts'

/**
 * A URL as the admin API shows it (§29.7): `<scheme>://<host>[:port]/…`, never its user info,
 * path or query, which carry the provider's secrets.
 */
export const maskUrl = (url: string): string => {
  if (!URL.canParse(url)) return '…'
  const { protocol, host } = new URL(url)
  return `${protocol}//${host}/…`
}

export const toTvSourceSettingsDto = (settings: TvSourceSettings): TvSourceSettingsDto => ({
  kind: settings.kind,
  playlistUrl: maskUrl(settings.playlistUrl),
  ...(settings.guideUrl === undefined ? {} : { guideUrl: maskUrl(settings.guideUrl) }),
  ...(settings.userAgent === undefined ? {} : { userAgent: settings.userAgent }),
})

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

/** The channels a viewer sees (§29.7); guide and favourite fields come with the guide slice. */
export const toTvChannelsResponse = (view: TvChannelsView): TvChannelsResponse => ({
  groups: view.groups.map((group) => ({ id: group.id, name: group.name })),
  items: view.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    ...(channel.number === undefined ? {} : { number: channel.number }),
    groupId: channel.groupId,
    ...(channel.logoPath === undefined
      ? {}
      : { logoUrl: `${apiPrefix}/tv/channels/${encodeURIComponent(channel.id)}/logo` }),
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
