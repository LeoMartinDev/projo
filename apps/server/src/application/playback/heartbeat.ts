import { ok, type Result } from '@projo/shared'

import { everything, type PlayableSources } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { PlaybackSession, PlaybackSessionRepository } from '../../core/playback/session.ts'
import {
  applyPosition,
  creditsStartOf,
  type ItemProgress,
  type ProgressRepository,
} from '../../core/progress/progress.ts'
import { itemTimeline, segmentsForVersion } from '../../core/segments/chapters.ts'
import type { AuthorizePlayback } from './authorize-playback.ts'
import type { PlaybackAccess, SessionAccessError } from './shared/session-access.ts'

const versionDurationMs = (
  playableSources: Pick<PlayableSources, 'findSource' | 'listReadySources'>,
  session: PlaybackSession,
): number | undefined => {
  const source = playableSources.findSource(session.sourceId)
  if (source === undefined) return undefined
  const { stackGroupId } = source
  if (stackGroupId === undefined) return source.media?.durationMs
  const durations = playableSources
    .listReadySources({ itemId: session.itemId, scope: everything })
    .filter((part) => part.stackGroupId === stackGroupId)
    .map((part) => part.media?.durationMs)
  if (durations.length === 0 || durations.some((duration) => duration === undefined)) {
    return undefined
  }
  return durations.reduce<number>((total, duration) => total + (duration ?? 0), 0)
}

export const heartbeatFactory =
  ({
    authorize,
    sessionRepository,
    playableSources,
    progressRepository,
    clock,
  }: {
    authorize: AuthorizePlayback
    sessionRepository: PlaybackSessionRepository
    playableSources: PlayableSources
    progressRepository: ProgressRepository
    clock: Clock
  }) =>
  async ({
    positionMs,
    ...access
  }: PlaybackAccess & {
    positionMs: number
  }): Promise<
    Result<{ session: PlaybackSession; progress?: ItemProgress }, SessionAccessError>
  > => {
    const authorized = authorize(access)
    if (!authorized.ok) return authorized
    const session = authorized.value
    const at = clock.now()
    sessionRepository.heartbeat({ id: session.id, at, positionMs })
    const updated = { ...session, lastHeartbeatAt: at, positionMs }

    const { profileId } = session
    const previous = progressRepository.find({ profileId, itemId: session.itemId })
    const versionMs = versionDurationMs(playableSources, session)
    const durationMs = versionMs ?? previous?.durationMs
    if (durationMs === undefined || durationMs <= 0) return ok({ session: updated })
    const itemIds = new Set([
      session.itemId,
      ...playableSources.listSourceItemIds(session.sourceId),
    ])
    let progress: ItemProgress | undefined
    for (const itemId of itemIds) {
      const saved = applyPosition(
        itemId === session.itemId ? previous : progressRepository.find({ profileId, itemId }),
        {
          profileId,
          itemId,
          positionMs,
          durationMs,
          at,
          ...creditsStartOf(
            segmentsForVersion(playableSources.listMediaSegments(itemId), {
              referenceMs: itemTimeline(
                playableSources.listReadySources({ itemId, scope: everything }),
              ).durationMs,
              playedMs: versionMs,
            }),
          ),
        },
      )
      progressRepository.save(saved)
      if (itemId === session.itemId) progress = saved
    }
    return ok({ session: updated, ...(progress === undefined ? {} : { progress }) })
  }

export type Heartbeat = ReturnType<typeof heartbeatFactory>
