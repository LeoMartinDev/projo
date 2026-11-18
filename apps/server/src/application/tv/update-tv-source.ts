import { type AppError, appError, err, ok, type Result } from '@projo/shared'
import { limitFromAccount } from '@projo/shared/api/tv'

import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import {
  applySettingsPatch,
  guideUrlOf,
  listingSettingsChanged,
  type TvRefreshActivity,
  type TvSource,
  type TvSourceRepository,
  type TvSourceSettingsPatch,
} from '../../core/tv/source.ts'
import { queueTvGuide, queueTvSourceRefresh } from './shared/tv-jobs.ts'
import { type TvSourceView, toTvSourceView } from './shared/tv-source-view.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById' | 'save'>
  tvChannels: Pick<TvChannelRepository, 'countsBySource'>
  refreshActivity: TvRefreshActivity
  jobQueue: JobQueue
  logger: Logger
}

export type UpdateTvSourceError = AppError<'tv/source_not_found' | 'tv/source_invalid'>

/**
 * Changes a source's name, settings or connection limit (§29.7); a change that reaches the
 * channel listing (playlist URL, `User-Agent`, Xtream server URL or credentials, Freebox address)
 * queues a refresh. An `xtream` source's limit is its account's: the admin cannot set it.
 */
export const updateTvSourceFactory =
  ({ tvSources, tvChannels, refreshActivity, jobQueue, logger }: Deps) =>
  (input: {
    id: string
    name?: string
    settings?: TvSourceSettingsPatch
    /** `'none'` removes the limit. */
    maxConnections?: number | 'none'
    /** The channel snapshots switch (§29.4); `'default'` goes back to the default. */
    snapshots?: boolean | 'default'
    snapshotGrabsPerHour?: number
  }): Result<TvSourceView, UpdateTvSourceError> => {
    const source = tvSources.findById(input.id)
    if (source === undefined)
      return err(
        appError('tv/source_not_found', 'tv source not found', { context: { id: input.id } }),
      )
    const settings =
      input.settings === undefined
        ? source.settings
        : applySettingsPatch(source.settings, input.settings)
    if (settings === undefined)
      return err(
        appError('tv/source_invalid', 'the kind of a tv source cannot change', {
          context: { id: input.id, kind: source.settings.kind },
        }),
      )
    if (input.maxConnections !== undefined && limitFromAccount(source.settings.kind))
      return err(
        appError('tv/source_invalid', 'the connection limit of this source is its account limit', {
          context: { id: input.id, kind: source.settings.kind },
        }),
      )
    const { maxConnections: _previous, snapshots: _snapshots, ...rest } = source
    const maxConnections =
      input.maxConnections === undefined ? source.maxConnections : input.maxConnections
    const snapshots = input.snapshots === undefined ? source.snapshots : input.snapshots
    const updated: TvSource = {
      ...rest,
      name: input.name ?? source.name,
      settings,
      ...(maxConnections === undefined || maxConnections === 'none' ? {} : { maxConnections }),
      ...(snapshots === undefined || snapshots === 'default' ? {} : { snapshots }),
      ...(input.snapshotGrabsPerHour === undefined
        ? {}
        : { snapshotGrabsPerHour: input.snapshotGrabsPerHour }),
    }
    tvSources.save(updated)
    const refresh = listingSettingsChanged(source.settings, settings)
    if (refresh) queueTvSourceRefresh(jobQueue, source.id)
    // A refresh queues the guide after it; a new XMLTV URL alone queues it now (§29.3).
    else if (guideUrlOf(source.settings) !== guideUrlOf(settings)) queueTvGuide(jobQueue, source.id)
    logger.info('tv source updated', { tvSourceId: source.id, refresh })
    return ok(
      toTvSourceView({
        source: updated,
        counts: tvChannels.countsBySource().get(source.id),
        refreshing: refresh || refreshActivity.refreshingSourceIds().has(source.id),
      }),
    )
  }

export type UpdateTvSource = ReturnType<typeof updateTvSourceFactory>
