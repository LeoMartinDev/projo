import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvRefreshActivity, TvSourceRepository } from '../../core/tv/source.ts'
import { type TvSourceDetailView, toTvSourceView } from './shared/tv-source-view.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById'>
  tvChannels: Pick<TvChannelRepository, 'countsBySource' | 'groupsOf'>
  refreshActivity: TvRefreshActivity
}

export type GetTvSourceError = AppError<'tv/source_not_found'>

/** A source with its groups, for its dialog (§29.6). */
export const getTvSourceFactory =
  ({ tvSources, tvChannels, refreshActivity }: Deps) =>
  ({ id }: { id: string }): Result<TvSourceDetailView, GetTvSourceError> => {
    const source = tvSources.findById(id)
    if (source === undefined)
      return err(appError('tv/source_not_found', 'tv source not found', { context: { id } }))
    return ok({
      ...toTvSourceView({
        source,
        counts: tvChannels.countsBySource().get(id),
        refreshing: refreshActivity.refreshingSourceIds().has(id),
      }),
      groups: tvChannels.groupsOf(id),
    })
  }

export type GetTvSource = ReturnType<typeof getTvSourceFactory>
