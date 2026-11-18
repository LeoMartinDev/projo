import type { Clock } from '../../core/clock.ts'
import { snapshotTimings } from '../../core/tv/snapshot-schedule.ts'

/**
 * The TV pages' hints (§29.4): the channels each profile's page shows in its viewport, kept 5
 * minutes, which the background grabs take first. Held in memory, per profile.
 */
export const visibleChannelsFactory = ({ clock }: { clock: Clock }) => {
  const hints = new Map<string, { channelIds: ReadonlySet<string>; atMs: number }>()

  const prune = (nowMs: number): void => {
    for (const [profileId, hint] of hints)
      if (nowMs - hint.atMs >= snapshotTimings.hintMs) hints.delete(profileId)
  }

  return {
    /** Replaces the profile's hint. */
    record: ({ profileId, channelIds }: { profileId: string; channelIds: readonly string[] }) => {
      const nowMs = clock.now().getTime()
      prune(nowMs)
      if (channelIds.length === 0) hints.delete(profileId)
      else hints.set(profileId, { channelIds: new Set(channelIds), atMs: nowMs })
    },
    /** Every channel a page showed in the last 5 minutes. */
    visible: (): ReadonlySet<string> => {
      prune(clock.now().getTime())
      return new Set([...hints.values()].flatMap((hint) => [...hint.channelIds]))
    },
  }
}

export type VisibleChannels = ReturnType<typeof visibleChannelsFactory>
