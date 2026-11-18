import { type AppError, appError, err, ok, type Result } from '@projo/shared'

import type { TvChannelRepository } from '../../core/tv/channel.ts'
import { type TvLogoFiles, tvLogoContentType } from '../../core/tv/logo.ts'

type Deps = {
  tvChannels: Pick<TvChannelRepository, 'findChannel'>
  logoFiles: Pick<TvLogoFiles, 'absolutePath'>
}

export type GetTvChannelLogoError = AppError<'tv/channel_not_found'>

/** The logo file of an enabled channel, of any channel to an admin (§29.7). */
export const getTvChannelLogoFactory =
  ({ tvChannels, logoFiles }: Deps) =>
  ({
    channelId,
    admin,
  }: {
    channelId: string
    admin: boolean
  }): Result<{ path: string; contentType: string }, GetTvChannelLogoError> => {
    const channel = tvChannels.findChannel(channelId)
    const visible =
      channel !== undefined && channel.missingSince === undefined && (admin || channel.enabled)
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
