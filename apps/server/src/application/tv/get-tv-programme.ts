import { type AppError, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { TvChannelRepository } from '../../core/tv/channel.ts'
import { TV_GUIDE_PAST_MS, type TvGuideRepository, type TvProgramme } from '../../core/tv/guide.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'
import { tvProgrammeNotFound, viewableChannel } from './shared/viewable-channel.ts'

type Deps = {
  guide: Pick<TvGuideRepository, 'findProgramme' | 'programmeAfter'>
  tvChannels: Pick<TvChannelRepository, 'findChannel'>
  tvAccess: TvProfileAccess
  clock: Clock
}

export type TvProgrammeView = { programme: TvProgramme; next?: TvProgramme }

export type GetTvProgrammeError = AppError<'tv/programme_not_found'>

/**
 * A programme in full with the one that follows it on its channel (§29.7): of a channel the
 * profile sees (§29.6), ended at most 6 hours ago; anything else does not exist for it.
 */
export const getTvProgrammeFactory =
  ({ guide, tvChannels, tvAccess, clock }: Deps) =>
  ({
    programmeId,
    profileId,
  }: {
    programmeId: string
    profileId: string
  }): Result<TvProgrammeView, GetTvProgrammeError> => {
    const programme = guide.findProgramme(programmeId)
    if (
      programme === undefined ||
      programme.endAt.getTime() <= clock.now().getTime() - TV_GUIDE_PAST_MS ||
      !viewableChannel({ tvChannels, tvAccess }, { channelId: programme.channelId, profileId }).ok
    )
      return tvProgrammeNotFound(programmeId)
    const next = guide.programmeAfter({ channelId: programme.channelId, at: programme.endAt })
    return ok({ programme, ...(next === undefined ? {} : { next }) })
  }

export type GetTvProgramme = ReturnType<typeof getTvProgrammeFactory>
