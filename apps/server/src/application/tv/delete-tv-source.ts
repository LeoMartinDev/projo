import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvLogoFiles } from '../../core/tv/logo.ts'
import type { TvSnapshotRepository } from '../../core/tv/snapshot.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById' | 'delete'>
  tvChannels: Pick<TvChannelRepository, 'logoPathsOf'>
  snapshots: Pick<TvSnapshotRepository, 'snapshotPathsOf'>
  logoFiles: Pick<TvLogoFiles, 'remove'>
  logger: Logger
}

export type DeleteTvSourceError = AppError<'tv/source_not_found'>

/** Deletes a source with its groups, channels, favourites, logos and snapshots (§29.7). */
export const deleteTvSourceFactory =
  ({ tvSources, tvChannels, snapshots, logoFiles, logger }: Deps) =>
  async ({ id }: { id: string }): Promise<Result<void, DeleteTvSourceError>> => {
    if (tvSources.findById(id) === undefined)
      return err(appError('tv/source_not_found', 'tv source not found', { context: { id } }))
    const files = [...tvChannels.logoPathsOf(id), ...snapshots.snapshotPathsOf(id)]
    tvSources.delete(id)
    await Promise.all(files.map((path) => logoFiles.remove(path)))
    logger.info('tv source deleted', { tvSourceId: id })
    return ok()
  }

export type DeleteTvSource = ReturnType<typeof deleteTvSourceFactory>
