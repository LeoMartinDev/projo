import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { TvChannelRepository } from '../../core/tv/channel.ts'
import { type TvLogoFiles, tvLogoContentType } from '../../core/tv/logo.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel'>
  tvAccess: TvProfileAccess
  logoFiles: Pick<TvLogoFiles, 'absolutePath'>
}

export type GetTvChannelLogoError = AppError<'tv/channel_not_found'>

/**
 * The logo file of a channel the profile sees (§29.7), of any present channel to an admin (its
 * Admin → TV page, whatever the profile's Live TV access).
 */
export const getTvChannelLogoFactory =
  ({ tvChannels, tvAccess, logoFiles }: Deps) =>
  ({
    channelId,
    profileId,
    admin,
  }: {
    channelId: string
    profileId: string
    admin: boolean
  }): Result<{ path: string; contentType: string }, GetTvChannelLogoError> => {
    const channel = tvChannels.findChannel(channelId)
    const visible =
      channel !== undefined &&
      channel.missingSince === undefined &&
      (admin || (channel.enabled && tvAccess.hasLiveTv(profileId)))
    if (!visible || channel.logoPath === undefined)
      return err(
        appError('tv/channel_not_found', 'tv channel logo not found', {
          context: { id: channelId },
        }),
      )
    return ok({
      path: logoFiles.absolutePath(channel.logoPath),
      contentType: tvLogoContentType(channel.logoPath),
    })
  }

export type GetTvChannelLogo = ReturnType<typeof getTvChannelLogoFactory>
