import type { Clock } from '../../core/clock.ts'
import type { TvGuideRepository, TvNowNext } from '../../core/tv/guide.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'

/**
 * Now and next of the channels a profile sees (§29.7): the lightweight read the TV page and the
 * player repeat every minute; nothing without Live TV access (§29.6).
 */
export const listTvGuideFactory =
  ({
    tvAccess,
    guide,
    clock,
  }: {
    tvAccess: TvProfileAccess
    guide: Pick<TvGuideRepository, 'nowAndNext'>
    clock: Clock
  }) =>
  ({ profileId }: { profileId: string }): ReadonlyMap<string, TvNowNext> =>
    tvAccess.hasLiveTv(profileId) ? guide.nowAndNext(clock.now()) : new Map()

export type ListTvGuide = ReturnType<typeof listTvGuideFactory>
