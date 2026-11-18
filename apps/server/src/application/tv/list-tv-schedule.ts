import type { TvGuideRepository, TvScheduleProgramme } from '../../core/tv/guide.ts'
import type { TvProfileAccess } from '../../core/tv/viewer.ts'

/** A channel of the guide grid's read and its programmes, by start. */
export type TvScheduleEntry = { channelId: string; programmes: TvScheduleProgramme[] }

/**
 * The guide grid's programmes (§29.7): those overlapping `[from, to)` of the channels asked that
 * the profile sees, in the order asked, each channel once; a channel without programme there,
 * and every channel without Live TV access (§29.6), is left out. The range is bounded at the
 * boundary (`tvScheduleQuerySchema`).
 */
export const listTvScheduleFactory =
  ({
    tvAccess,
    guide,
  }: {
    tvAccess: TvProfileAccess
    guide: Pick<TvGuideRepository, 'schedule'>
  }) =>
  ({
    profileId,
    channelIds,
    from,
    to,
  }: {
    profileId: string
    channelIds: readonly string[]
    from: Date
    to: Date
  }): TvScheduleEntry[] => {
    if (!tvAccess.hasLiveTv(profileId)) return []
    const asked = [...new Set(channelIds)]
    const byChannel = new Map<string, TvScheduleProgramme[]>()
    for (const programme of guide.schedule({ channelIds: asked, from, to })) {
      const list = byChannel.get(programme.channelId)
      if (list === undefined) byChannel.set(programme.channelId, [programme])
      else list.push(programme)
    }
    return asked.flatMap((channelId) => {
      const programmes = byChannel.get(channelId)
      return programmes === undefined
        ? []
        : [
            {
              channelId,
              programmes: programmes.toSorted((a, b) => a.startAt.getTime() - b.startAt.getTime()),
            },
          ]
    })
  }

export type ListTvSchedule = ReturnType<typeof listTvScheduleFactory>
