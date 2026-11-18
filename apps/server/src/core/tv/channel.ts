import type { TvChannelProbe } from './live.ts'

/** Where a channel's stream is read; never leaves the server (§29.2). */
export type TvUpstream = { url: string; userAgent?: string; referrer?: string }

export type TvGroup = {
  id: string
  sourceId: string
  /** `''` for the source's unnamed group. */
  name: string
  /** Decides the state of the channels the group gains later (§29.2). */
  enabled: boolean
  position: number
}

export type TvChannel = {
  id: string
  sourceId: string
  key: string
  name: string
  number?: number
  groupId: string
  position: number
  upstream: TvUpstream
  guideKey?: string
  logoUrl?: string
  /** Relative to the images directory; kept (and served) while a newer URL fails. */
  logoPath?: string
  /** URL of the last download attempt. */
  logoFetchedUrl?: string
  /** When the file at `logoPath` was fetched. */
  logoFetchedAt?: Date
  /** Set while the last attempt failed. */
  logoFailedAt?: Date
  enabled: boolean
  missingSince?: Date
  createdAt: Date
}

export type TvChannelCounts = { channelCount: number; enabledChannelCount: number }

export type TvGroupSummary = TvGroup & TvChannelCounts

/** What a refresh writes, computed by `planTvRefresh`; applied in one transaction. */
export type TvRefreshPlan = {
  sourceId: string
  groups: {
    insert: TvGroup[]
    update: { id: string; position: number }[]
    delete: string[]
  }
  channels: {
    insert: TvChannel[]
    update: TvChannelUpdate[]
    markMissing: { ids: string[]; at: Date }
    delete: string[]
  }
}

export type TvChannelUpdate = Pick<
  TvChannel,
  'id' | 'name' | 'groupId' | 'position' | 'upstream'
> & {
  number: number | undefined
  guideKey: string | undefined
  logoUrl: string | undefined
}

export type TvChannelRepository = {
  /** Every group and channel of the source, missing ones included. */
  stateOf: (sourceId: string) => { groups: TvGroup[]; channels: TvChannel[] }
  applyRefresh: (plan: TvRefreshPlan) => void
  /** Present channels per source. */
  countsBySource: () => Map<string, TvChannelCounts>
  groupsOf: (sourceId: string) => TvGroupSummary[]
  findGroup: (id: string) => TvGroupSummary | undefined
  /** Sets the group's flag and every one of its channels (§29.2). */
  setGroupEnabled: (input: { id: string; enabled: boolean }) => void
  findChannel: (id: string) => TvChannel | undefined
  setChannelEnabled: (input: { id: string; enabled: boolean }) => void
  /** Present channels of a source in playlist order; `search` is a `searchNameOf` value. */
  listChannels: (input: {
    sourceId: string
    search?: string
    groupId?: string
    offset: number
    limit: number
  }) => { items: TvChannel[]; total: number }
  /**
   * Enabled present channels whose logo must be fetched (never tried, URL changed, or failed
   * before `retryFailedBefore`), and channels whose logo must be dropped (§29.2).
   */
  logoWork: (input: { sourceId: string; retryFailedBefore: Date }) => {
    fetch: TvChannel[]
    drop: TvChannel[]
  }
  /**
   * Records an attempt at `url`: `path` on success, a failure (previous file kept) without.
   * `false` when the channel is gone (deleted meanwhile with its source or by a refresh).
   */
  recordLogo: (input: { id: string; url: string; at: Date; path?: string }) => boolean
  /** Forgets the channel's logo file (its source no longer gives one). */
  dropLogo: (id: string) => void
  /** Logo files of the source's channels (to delete with it). */
  logoPathsOf: (sourceId: string) => string[]
  /**
   * Every enabled present channel a viewer sees (§29.7), ordered by source name, then group and
   * channel position, with their groups in the same order.
   */
  listViewable: () => { groups: TvGroup[]; channels: TvChannel[] }
  /** The channel's cached probe (§29.4). */
  probeOf: (id: string) => TvChannelProbe | undefined
  /** Caches a probe, or drops the cached one without `probe`. */
  recordProbe: (input: { id: string; probe?: TvChannelProbe; at: Date }) => void
}

/** A name lowercased without accents (§29.7: the admin's search ignores both). */
export const searchNameOf = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A channel gone from its source is deleted after this long (§29.2). */
export const TV_MISSING_CHANNEL_RETENTION_MS = 7 * 24 * 60 * 60_000

/** A logo whose download failed is tried again after this long. */
export const TV_LOGO_RETRY_MS = 24 * 60 * 60_000
