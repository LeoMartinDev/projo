import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import { type CatalogRepository, everything } from '../../core/catalog/catalog.ts'
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

/**
 * Ends a session once: `ended_at`, ffmpeg killed, `playback.session_terminated` published to the
 * auth session that owns it (§10.6). The cache folder is purged later (§10.3, 5 min of grace).
 */
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
    /** Lets the HLS stream forget its per-session state. */
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

/**
 * `PlaybackSessionTerminator.endWithin`: ends the active sessions on sources or items about to be
 * deleted (library deleted, root removed, local item pruned), before the cascade drops their rows.
 * The player is told the administrator stopped it.
 */
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

/** Who uses a playback session: the account, and the request's active profile (resolved). */
export type PlaybackAccess = {
  sessionId: string
  accountId: string
  /** `X-Profile-Id`, else the auth session's last profile (`<video>`, HLS, `sendBeacon`). */
  profileId: string | undefined
}

/** The item exists for the profile (library access, maximum rating). */
export type ItemVisibility = (input: { itemId: string; profileId: string }) => boolean

/** The account's, and the active profile is the session's or sees its item (§14). */
const usableBy = (
  session: PlaybackSession,
  { accountId, profileId }: Omit<PlaybackAccess, 'sessionId'>,
  isItemVisible: ItemVisibility,
): boolean =>
  session.accountId === accountId &&
  profileId !== undefined &&
  (session.profileId === profileId || isItemVisible({ itemId: session.itemId, profileId }))

/**
 * A playback session usable by this request: it exists, belongs to the account, the active
 * profile is the session's or sees its item (§14: another profile of the account, a child's,
 * cannot borrow a session on a title it does not see), and it is not over (a session past 60 s
 * without heartbeat is ended on the spot).
 */
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

/** A stream URL (§20): the session it names and the secret it carries, nothing else. */
export type StreamAccess = { sessionId: string; secret: string }

/**
 * The session a capability URL names, when its secret is the session's (no cookie, no profile:
 * AirPlay receivers and AVPlayer sub-requests carry none) and the session is not over (past 60 s
 * without heartbeat it is ended on the spot). A wrong secret is the same as no session.
 */
export const authorizeStreamFactory =
  ({
    sessionRepository,
    endSession,
    hashSecret,
    clock,
  }: {
    sessionRepository: PlaybackSessionRepository
    endSession: EndPlaybackSession
    /** The hash stored by `create-session` (`SessionTokens.hash`). */
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

/**
 * Item duration of the version a session plays (§8.4): the source's, or the parts of its stack
 * added up. Undefined when a part has no stored duration.
 */
const versionDurationMs = (
  catalogRepository: CatalogRepository,
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

/**
 * `PUT /playback/sessions/:id/heartbeat` (§10.6): keeps the session alive and writes the
 * progress of the session's profile (§13.1). `positionMs` is on the item timeline (cumulative
 * over the parts of a stack), measured against the version's duration. A multi-episode file
 * (§8.4) writes the same position, and "vu", on every episode it holds.
 */
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
    catalogRepository: CatalogRepository
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
    const durationMs = versionDurationMs(catalogRepository, session) ?? previous?.durationMs
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
          // §12.4: entering the credits marks it watched, like 93 %.
          ...creditsStartOf(catalogRepository.listMediaSegments(itemId)),
        },
      )
      progressRepository.save(saved)
      if (itemId === session.itemId) progress = saved
    }
    return ok({ session: updated, ...(progress === undefined ? {} : { progress }) })
  }

export type Heartbeat = ReturnType<typeof heartbeatFactory>

/**
 * `DELETE /playback/sessions/:id`: same access rule as the other session routes (a restricted
 * profile of the account cannot stop a session on a title it does not see), idempotent for an
 * already ended session.
 */
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

/** Per-session streaming state (segmenter ffmpeg, HLS plan), as seen by the sweep. */
export type LiveStreams = {
  sessionIds: () => string[]
  /** Kills the session's ffmpeg and forgets its state. */
  release: (sessionId: string) => void
}

/**
 * Periodic (§10.3, §24): ends sessions silent for 60 s, then deletes the cache folders of
 * sessions ended more than 5 min ago (and orphan folders). Safety net: streaming state of a
 * session gone from the database (SQL cascade) or already ended is released; its folder waits for
 * the next pass, the time for the killed ffmpeg to exit.
 */
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
