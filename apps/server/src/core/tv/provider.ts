import type { AppError, Result } from '@projo/shared'

import type { TvUpstream } from './channel.ts'
import type { TvSourceSettings } from './source.ts'

/** A channel as a source lists it; `key` is its identity across refreshes (§29.2). */
export type TvProviderChannel = {
  key: string
  name: string
  number?: number
  /** Group name; `''` for a channel without one. */
  group: string
  logoUrl?: string
  upstream: TvUpstream
  /** What the guide matches the channel on (M3U `tvg-id`), §29.3. */
  guideKey?: string
}

export type TvChannelListing = {
  channels: TvProviderChannel[]
  /** Guide location the listing announces (an M3U header's `url-tvg`). */
  guideUrl?: string
}

export type TvProviderError = AppError<'tv/source_unreachable' | 'tv/source_invalid'>

/**
 * A source's connector (§29.2), one adapter per kind behind it (`infrastructure/tv/<kind>/`);
 * nothing else knows a channel's kind. The guide reader joins it with the guide slice (§29.3).
 */
export type TvSourceProvider = {
  listChannels: (input: {
    settings: TvSourceSettings
    signal?: AbortSignal
  }) => Promise<Result<TvChannelListing, TvProviderError>>
  /** The stream to open for a channel: its stored upstream completed from the source. */
  upstreamOf: (input: { settings: TvSourceSettings; upstream: TvUpstream }) => TvUpstream
}
