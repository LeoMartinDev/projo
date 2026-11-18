import type { TvSourceProvider } from '../../core/tv/provider.ts'
import type { FreeboxProvider } from './freebox/freebox-provider.ts'
import type { M3uProvider } from './m3u/m3u-provider.ts'
import type { XtreamProvider } from './xtream/xtream-provider.ts'

/**
 * The one `TvSourceProvider`: hands each source to the connector of its kind (§29.2), so that
 * channels, guide, relay and player never switch on it.
 */
export const createTvSourceProvider = ({
  m3u,
  xtream,
  freebox,
}: {
  m3u: M3uProvider
  xtream: XtreamProvider
  freebox: FreeboxProvider
}): TvSourceProvider => ({
  listChannels: ({ settings, signal }) => {
    const input = signal === undefined ? {} : { signal }
    switch (settings.kind) {
      case 'freebox':
        return freebox.listChannels({ settings, ...input })
      case 'xtream':
        return xtream.listChannels({ settings, ...input })
      case 'm3u':
        return m3u.listChannels({ settings, ...input })
    }
  },
  readGuide: ({ source, sink, signal }) => {
    const input = { sink, ...(signal === undefined ? {} : { signal }) }
    const { settings, discoveredGuideUrl } = source
    switch (settings.kind) {
      case 'freebox':
        return freebox.readGuide({ settings, ...input })
      case 'xtream':
        return xtream.readGuide({ settings, ...input })
      case 'm3u':
        return m3u.readGuide({
          source: {
            settings,
            ...(discoveredGuideUrl === undefined ? {} : { discoveredGuideUrl }),
          },
          ...input,
        })
    }
  },
  upstreamOf: ({ settings, upstream }) => {
    switch (settings.kind) {
      case 'freebox':
        return freebox.upstreamOf({ settings, upstream })
      case 'xtream':
        return xtream.upstreamOf({ settings, upstream })
      case 'm3u':
        return m3u.upstreamOf({ settings, upstream })
    }
  },
})
