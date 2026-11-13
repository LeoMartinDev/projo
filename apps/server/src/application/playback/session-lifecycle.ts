import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type PlayableSources, everything } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'
import type { HlsSegmenter, TranscodeCache } from '../../core/playback/ports.ts'
import {
  isExpired,
  type PlaybackScope,
  type PlaybackSession,
  type PlaybackSessionRepository,
  sessionTimings,
  type TerminationReason,
} from '../../core/playback/session.ts'
import {
  applyPosition,
  creditsStartOf,
  type ItemProgress,
  type ProgressRepository,
} from '../../core/progress/progress.ts'
import { itemTimeline, segmentsForVersion } from '../../core/segments/chapters.ts'

export type EndedSession = PlaybackSession & { endedAt: Date }

export type SessionAccessError = AppError<'playback/session_not_found' | 'playback/session_expired'>

const notFound = (sessionId: string) =>
  err(
    appError('playback/session_not_found', 'playback session not found', {
      context: { sessionId },
    }),
  )

const expired = (sessionId: string) =>
  err(appError('playback/session_expired', 'playback session ended', { context: { sessionId } }))

export const endPlaybackSessionFactory =
  ({
    sessionRepository,
    segmenter,
    eventBus,
    clock,
    logger,
    onEnded,
  }: {
    sessionRepository: PlaybackSessionRepository
    segmenter: HlsSegmenter
    eventBus: EventBus
    clock: Clock
    logger: Logger
    onEnded?: (sessionId: string) => void
  }) =>
  ({ session, reason }: { session: PlaybackSession; reason: TerminationReason }): EndedSession => {
    if (session.endedAt !== undefined) return { ...session, endedAt: session.endedAt }
    const endedAt = clock.now()
    sessionRepository.end({ id: session.id, at: endedAt })
    segmenter.stop(session.id)
    onEnded?.(session.id)
    eventBus.publish('playback.session_terminated', {
      playbackSessionId: session.id,
      sessionId: session.authSessionId,
      reason,
    })
    logger.info('playback session ended', { sessionId: session.id, reason })
    return { ...session, endedAt }
  }

export type EndPlaybackSession = ReturnType<typeof endPlaybackSessionFactory>

export const endPlaybackSessionsWithinFactory =
  ({
    sessionRepository,
    endSession,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
  }) =>
  (scope: PlaybackScope): void => {
    for (const session of sessionRepository.listActiveWithin(scope)) {
      endSession({ session, reason: 'admin' })
    }
  }

export type PlaybackAccess = {
  sessionId: string
  accountId: string
  profileId: string | undefined
}

export type ItemVisibility = (input: { itemId: string; profileId: string }) => boolean

const usableBy = (
  session: PlaybackSession,
  { accountId, profileId }: Omit<PlaybackAccess, 'sessionId'>,
  isItemVisible: ItemVisibility,
): boolean =>
  session.accountId === accountId &&
  profileId !== undefined &&
  (session.profileId === profileId || isItemVisible({ itemId: session.itemId, profileId }))

export const authorizePlaybackFactory =
  ({
    sessionRepository,
    endSession,
    isItemVisible,
    clock,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    isItemVisible: ItemVisibility
    clock: Clock
  }) =>
  ({ sessionId, ...user }: PlaybackAccess): Result<PlaybackSession, SessionAccessError> => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || !usableBy(session, user, isItemVisible)) {
      return notFound(sessionId)
    }
    if (session.endedAt !== undefined) return expired(sessionId)
    if (isExpired(session, clock.now())) {
      endSession({ session, reason: 'timeout' })
      return expired(sessionId)
    }
    return ok(session)
  }

export type AuthorizePlayback = ReturnType<typeof authorizePlaybackFactory>

export type StreamAccess = { sessionId: string; secret: string }

export const authorizeStreamFactory =
  ({
    sessionRepository,
    endSession,
    hashSecret,
    clock,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    hashSecret: (secret: string) => string
    clock: Clock
  }) =>
  ({ sessionId, secret }: StreamAccess): Result<PlaybackSession, SessionAccessError> => {
    const session = sessionRepository.findById(sessionId)
    if (
      session?.streamSecretHash === undefined ||
      session.streamSecretHash !== hashSecret(secret)
    ) {
      return notFound(sessionId)
    }
    if (session.endedAt !== undefined) return expired(sessionId)
    if (isExpired(session, clock.now())) {
      endSession({ session, reason: 'timeout' })
      return expired(sessionId)
    }
    return ok(session)
  }

export type AuthorizeStream = ReturnType<typeof authorizeStreamFactory>

const versionDurationMs = (
  catalogRepository: Pick<PlayableSources, 'findSource' | 'listReadySources'>,
  session: PlaybackSession,
): number | undefined => {
  const source = catalogRepository.findSource(session.sourceId)
  if (source === undefined) return undefined
  const { stackGroupId } = source
  if (stackGroupId === undefined) return source.media?.durationMs
  const durations = catalogRepository
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
    catalogRepository,
    progressRepository,
    clock,
  }: {
    authorize: AuthorizePlayback
    sessionRepository: PlaybackSessionRepository
    catalogRepository: PlayableSources
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
    const versionMs = versionDurationMs(catalogRepository, session)
    const durationMs = versionMs ?? previous?.durationMs
    if (durationMs === undefined || durationMs <= 0) return ok({ session: updated })
    const itemIds = new Set([
      session.itemId,
      ...catalogRepository.listSourceItemIds(session.sourceId),
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
            segmentsForVersion(catalogRepository.listMediaSegments(itemId), {
              referenceMs: itemTimeline(
                catalogRepository.listReadySources({ itemId, scope: everything }),
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

export const stopPlaybackSessionFactory =
  ({
    sessionRepository,
    endSession,
    isItemVisible,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    isItemVisible: ItemVisibility
  }) =>
  async ({
    sessionId,
    ...user
  }: PlaybackAccess): Promise<Result<EndedSession, AppError<'playback/session_not_found'>>> => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || !usableBy(session, user, isItemVisible)) {
      return notFound(sessionId)
    }
    return ok(endSession({ session, reason: 'ended' }))
  }

export type StopPlaybackSession = ReturnType<typeof stopPlaybackSessionFactory>

export type LiveStreams = {
  sessionIds: () => string[]
  release: (sessionId: string) => void
}

export const sweepPlaybackSessionsFactory =
  ({
    sessionRepository,
    transcodeCache,
    endSession,
    streams,
    clock,
    logger,
  }: {
    sessionRepository: PlaybackSessionRepository
    transcodeCache: TranscodeCache
    endSession: EndPlaybackSession
    streams: LiveStreams
    clock: Clock
    logger: Logger
  }) =>
  (): { expired: number; purged: number; released: number } => {
    const now = clock.now()
    const stale = sessionRepository.listStale({
      notAfter: new Date(now.getTime() - sessionTimings.expireAfterMs),
    })
    for (const session of stale) endSession({ session, reason: 'timeout' })

    const released = new Set<string>()
    for (const sessionId of streams.sessionIds()) {
      const session = sessionRepository.findById(sessionId)
      if (session !== undefined && session.endedAt === undefined) continue
      streams.release(sessionId)
      released.add(sessionId)
      logger.warn('playback stream released without its session', {
        sessionId,
        ...(session === undefined ? { gone: true } : {}),
      })
    }

    let purged = 0
    for (const sessionId of transcodeCache.listSessionIds()) {
      if (released.has(sessionId)) continue
      const session = sessionRepository.findById(sessionId)
      const purgeable =
        session === undefined ||
        (session.endedAt !== undefined &&
          now.getTime() - session.endedAt.getTime() >= sessionTimings.cacheGraceMs)
      if (purgeable) {
        transcodeCache.remove(sessionId)
        purged += 1
      }
    }
    if (stale.length > 0 || purged > 0) {
      logger.debug('playback sessions swept', { expired: stale.length, purged })
    }
    return { expired: stale.length, purged, released: released.size }
  }

export type SweepPlaybackSessions = ReturnType<typeof sweepPlaybackSessionsFactory>
