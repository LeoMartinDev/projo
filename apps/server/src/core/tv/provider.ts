import type { AppError, Result } from '@projo/shared'

import type { TvUpstream } from './channel.ts'
import type { TvGuideRead, TvGuideSink } from './guide.ts'
import type { TvSource, TvSourceSettings } from './source.ts'

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
 * nothing else knows a channel's kind.
 */
export type TvSourceProvider = {
  listChannels: (input: {
    settings: TvSourceSettings
    signal?: AbortSignal
  }) => Promise<Result<TvChannelListing, TvProviderError>>
  /**
   * Streams the source's guide into `sink` as it is read (§29.3); `available: false` when the
   * source has no guide location (nothing fetched).
   */
  readGuide: (input: {
    source: Pick<TvSource, 'settings' | 'discoveredGuideUrl'>
    sink: TvGuideSink
    signal?: AbortSignal
  }) => Promise<TvGuideRead>
  /** The stream to open for a channel: its stored upstream completed from the source. */
  upstreamOf: (input: { settings: TvSourceSettings; upstream: TvUpstream }) => TvUpstream
}
