import type { TvSourceProvider } from '../../core/tv/provider.ts'
import type { FreeboxProvider } from './freebox/freebox-provider.ts'
import type { M3uProvider } from './m3u/m3u-provider.ts'

/**
 * The one `TvSourceProvider`: hands each source to the connector of its kind (§29.2), so that
 * channels, guide, relay and player never switch on it.
 */
export const createTvSourceProvider = ({
  m3u,
  freebox,
}: {
  m3u: M3uProvider
  freebox: FreeboxProvider
}): TvSourceProvider => ({
  listChannels: ({ settings, signal }) => {
    const input = signal === undefined ? {} : { signal }
    return settings.kind === 'freebox'
      ? freebox.listChannels({ settings, ...input })
      : m3u.listChannels({ settings, ...input })
  },
  readGuide: ({ source, sink, signal }) => {
    const input = { sink, ...(signal === undefined ? {} : { signal }) }
    const { settings, discoveredGuideUrl } = source
    return settings.kind === 'freebox'
      ? freebox.readGuide({ settings, ...input })
      : m3u.readGuide({
          source: {
            settings,
            ...(discoveredGuideUrl === undefined ? {} : { discoveredGuideUrl }),
          },
          ...input,
        })
  },
  upstreamOf: ({ settings, upstream }) =>
    settings.kind === 'freebox'
      ? freebox.upstreamOf({ settings, upstream })
      : m3u.upstreamOf({ settings, upstream }),
})
