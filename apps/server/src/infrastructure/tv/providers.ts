import type { TvSourceProvider } from '../../core/tv/provider.ts'
import type { M3uProvider } from './m3u/m3u-provider.ts'

/** The one `TvSourceProvider`: hands each source to the connector of its kind (§29.2). */
export const createTvSourceProvider = ({ m3u }: { m3u: M3uProvider }): TvSourceProvider => ({
  listChannels: (input) => m3u.listChannels(input),
  readGuide: (input) => m3u.readGuide(input),
  upstreamOf: (input) => m3u.upstreamOf(input),
})
