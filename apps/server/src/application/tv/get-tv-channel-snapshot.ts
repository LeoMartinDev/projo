import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvLogoFiles } from '../../core/tv/logo.ts'
import { type TvSnapshotRepository, tvSnapshotPathOf } from '../../core/tv/snapshot.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel'>
  snapshots: Pick<TvSnapshotRepository, 'snapshotAtOf'>
  tvAccess: TvProfileAccess
  files: Pick<TvLogoFiles, 'absolutePath'>
}

export type GetTvChannelSnapshotError = AppError<'tv/channel_not_found'>

/**
 * The snapshot file of a channel the profile sees (§29.7), of any present channel to an admin;
 * the access rule of its logo.
 */
export const getTvChannelSnapshotFactory =
  ({ tvChannels, snapshots, tvAccess, files }: Deps) =>
  ({
    channelId,
    profileId,
    admin,
  }: {
    channelId: string
    profileId: string
    admin: boolean
  }): Result<{ path: string }, GetTvChannelSnapshotError> => {
    const channel = tvChannels.findChannel(channelId)
    const visible =
      channel !== undefined &&
      channel.missingSince === undefined &&
      (admin || (channel.enabled && tvAccess.hasLiveTv(profileId)))
    if (!visible || snapshots.snapshotAtOf(channelId) === undefined)
      return err(
        appError('tv/channel_not_found', 'tv channel snapshot not found', {
          context: { id: channelId },
        }),
      )
    return ok({ path: files.absolutePath(tvSnapshotPathOf(channelId)) })
  }

export type GetTvChannelSnapshot = ReturnType<typeof getTvChannelSnapshotFactory>
