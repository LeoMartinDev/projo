import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { Logger } from '../../core/logger.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvLogoFiles } from '../../core/tv/logo.ts'
import type { TvSourceRepository } from '../../core/tv/source.ts'

type Deps = {
  tvSources: Pick<TvSourceRepository, 'findById' | 'delete'>
  tvChannels: Pick<TvChannelRepository, 'logoPathsOf'>
  logoFiles: Pick<TvLogoFiles, 'remove'>
  logger: Logger
}

export type DeleteTvSourceError = AppError<'tv/source_not_found'>

/** Deletes a source with its groups, channels, favourites and logos (§29.7). */
export const deleteTvSourceFactory =
  ({ tvSources, tvChannels, logoFiles, logger }: Deps) =>
  async ({ id }: { id: string }): Promise<Result<void, DeleteTvSourceError>> => {
    if (tvSources.findById(id) === undefined)
      return err(appError('tv/source_not_found', 'tv source not found', { context: { id } }))
    const logos = tvChannels.logoPathsOf(id)
    tvSources.delete(id)
    await Promise.all(logos.map((path) => logoFiles.remove(path)))
    logger.info('tv source deleted', { tvSourceId: id })
    return ok()
  }

export type DeleteTvSource = ReturnType<typeof deleteTvSourceFactory>
