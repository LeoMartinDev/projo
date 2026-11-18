import type { TvSourceKind } from '@projo/shared/api/tv'

export type { TvSourceKind }

/** Settings of an `m3u` source (§29.2): the playlist URL carries the provider's secret. */
export type M3uSettings = {
  kind: 'm3u'
  playlistUrl: string
  guideUrl?: string
  userAgent?: string
}

/** Settings of a source, one member per kind; stored in clear, masked in every admin answer. */
export type TvSourceSettings = M3uSettings

/**
 * Changes to a source's settings: an absent field keeps the stored value, `''` removes an
 * optional one (§29.7). The kind cannot change.
 */
export type TvSourceSettingsPatch = {
  kind: 'm3u'
  playlistUrl?: string
  guideUrl?: string
  userAgent?: string
}

export type TvSourceFailure = { code: string; message: string }

export type TvSource = {
  id: string
  name: string
  settings: TvSourceSettings
  maxConnections?: number
  /** Guide location found by the last refresh (an M3U header's `url-tvg`), §29.3. */
  discoveredGuideUrl?: string
  createdAt: Date
  lastAttemptAt?: Date
  lastRefreshAt?: Date
  lastError?: TvSourceFailure
  /** Consecutive failed refreshes; `tv/source_unreachable` is raised at 3 (§29.2). */
  failureCount: number
}

export const kindOf = (source: Pick<TvSource, 'settings'>): TvSourceKind => source.settings.kind

/** Consecutive failures that raise `tv/source_unreachable`. */
export const TV_SOURCE_FAILURES_BEFORE_NOTICE = 3

/** A source is refreshed once its last attempt is this old (§29.2). */
export const TV_SOURCE_REFRESH_INTERVAL_MS = 24 * 60 * 60_000

const optional = <K extends string>(key: K, value: string | undefined) =>
  value === undefined || value === '' ? {} : ({ [key]: value } as { [P in K]: string })

/** The settings once `patch` is applied, or `undefined` when its kind is not the source's. */
export const applySettingsPatch = (
  settings: TvSourceSettings,
  patch: TvSourceSettingsPatch,
): TvSourceSettings | undefined => {
  if (patch.kind !== settings.kind) return undefined
  return {
    kind: 'm3u',
    playlistUrl: patch.playlistUrl ?? settings.playlistUrl,
    ...optional('guideUrl', patch.guideUrl ?? settings.guideUrl),
    ...optional('userAgent', patch.userAgent ?? settings.userAgent),
  }
}

/** Whether the change reaches the channel listing (the guide URL does not): a refresh is due. */
export const listingSettingsChanged = (
  before: TvSourceSettings,
  after: TvSourceSettings,
): boolean => {
  const listingPart = (settings: TvSourceSettings) =>
    JSON.stringify(
      Object.entries(settings)
        .filter(([key]) => key !== 'guideUrl')
        .sort(([a], [b]) => a.localeCompare(b)),
    )
  return listingPart(before) !== listingPart(after)
}

export type TvSourceRepository = {
  list: () => TvSource[]
  findById: (id: string) => TvSource | undefined
  /** Inserts or replaces the source's own fields (name, settings, connection limit). */
  save: (source: TvSource) => void
  delete: (id: string) => void
  recordSuccess: (input: { id: string; at: Date; discoveredGuideUrl?: string }) => void
  /** Records the failure and returns the new count of consecutive failures. */
  recordFailure: (input: { id: string; at: Date; error: TvSourceFailure }) => number
}

/** Sources whose `refresh_tv_source` is queued or running. */
export type TvRefreshActivity = {
  refreshingSourceIds: () => ReadonlySet<string>
}

const refreshKeyPrefix = 'tv_source:'

/** `dedupe_key` of a source's `refresh_tv_source` (§18). */
export const tvRefreshDedupeKey = (sourceId: string): string => `${refreshKeyPrefix}${sourceId}`

/** The source of a `refresh_tv_source` dedupe key. */
export const sourceIdOfRefreshKey = (key: string): string | undefined =>
  key.startsWith(refreshKeyPrefix) ? key.slice(refreshKeyPrefix.length) : undefined

/** `dedupe_key` of a source's `fetch_tv_logos` (§18). */
export const tvLogosDedupeKey = (sourceId: string): string => `tv_logos:${sourceId}`
