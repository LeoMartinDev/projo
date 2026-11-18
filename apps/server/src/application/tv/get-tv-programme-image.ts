import { type AppError, ok, type Result } from '@projo/shared'

import type { TvChannelRepository } from '../../core/tv/channel.ts'
import type { TvGuideRepository } from '../../core/tv/guide.ts'
import { type TvLogoFiles, tvLogoContentType } from '../../core/tv/logo.ts'
import type { TvProgrammeImageRepository } from '../../core/tv/programme-image.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'
import { tvProgrammeNotFound } from './shared/viewable-channel.ts'

type Deps = {
  guide: Pick<TvGuideRepository, 'findProgramme'>
  tvChannels: Pick<TvChannelRepository, 'findChannel'>
  tvAccess: TvProfileAccess
  images: Pick<TvProgrammeImageRepository, 'pathOf'>
  files: Pick<TvLogoFiles, 'absolutePath'>
}

export type GetTvProgrammeImageError = AppError<'tv/programme_not_found'>

/**
 * The stored image of a programme (§29.7): of a channel the profile sees (§29.6), of any present
 * channel to an admin; never the provider's URL.
 */
export const getTvProgrammeImageFactory =
  ({ guide, tvChannels, tvAccess, images, files }: Deps) =>
  ({
    programmeId,
    profileId,
    admin,
  }: {
    programmeId: string
    profileId: string
    admin: boolean
  }): Result<{ path: string; contentType: string }, GetTvProgrammeImageError> => {
    const programme = guide.findProgramme(programmeId)
    const channel =
      programme === undefined ? undefined : tvChannels.findChannel(programme.channelId)
    const visible =
      channel !== undefined &&
      channel.missingSince === undefined &&
      (admin || (channel.enabled && tvAccess.hasLiveTv(profileId)))
    const path =
      visible && programme?.imageKey !== undefined ? images.pathOf(programme.imageKey) : undefined
    if (path === undefined) return tvProgrammeNotFound(programmeId)
    return ok({ path: files.absolutePath(path), contentType: tvLogoContentType(path) })
  }

export type GetTvProgrammeImage = ReturnType<typeof getTvProgrammeImageFactory>
