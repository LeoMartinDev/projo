import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvRefreshActivity, TvSourceRepository } from '../../core/tv/source.ts'
import { type TvSourceView, toTvSourceView } from './shared/tv-source-view.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'list'>
  tvChannels: Pick<TvChannelRepository, 'countsBySource'>
  refreshActivity: TvRefreshActivity
}

/** Admin → TV's table (§29.6). */
export const listTvSourcesFactory =
  ({ tvSources, tvChannels, refreshActivity }: Deps) =>
  (): TvSourceView[] => {
    const counts = tvChannels.countsBySource()
    const refreshing = refreshActivity.refreshingSourceIds()
    return tvSources.list().map((source) =>
      toTvSourceView({
        source,
        counts: counts.get(source.id),
        refreshing: refreshing.has(source.id),
      }),
    )
  }

export type ListTvSources = ReturnType<typeof listTvSourcesFactory>
