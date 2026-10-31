import type { PlaybackMode, PlaybackQuality } from '@projo/shared/api/playback'

/** A playback session (§6.4 `playback_sessions`, §10.6). */
export type PlaybackSession = {
  id: string
  profileId: string
  /** Auth session (cookie or bearer) that opened it: the SSE stream it is reported to. */
  authSessionId: string
  /** Account of the auth session: stream URLs are only served to it (§20). */
  accountId: string
  sourceId: string
  itemId: string
  mode: PlaybackMode
  quality?: PlaybackQuality
  audioStream?: number
  /** `source_subtitles.id` of the selected track (text sent as WebVTT, or bitmap burnt in). */
  subtitleTrackId?: string
  burnIn: boolean
  /**
   * HLS: the audio track copied or transcoded to AAC (remux: from the client capabilities;
   * transcode: always `aac`).
   */
  audioDelivery?: 'copy' | 'aac'
  /**
   * §20: hash of the secret of the stream URLs (`/stream/:id/:secret/…`), which carry no cookie.
   * Absent on sessions made before it: their stream URLs no longer work.
   */
  streamSecretHash?: string
  startedAt: Date
  lastHeartbeatAt: Date
  positionMs: number
  endedAt?: Date
}

/** §24: heartbeat every 10 s, ended after 60 s without one, cache kept 5 min after the end. */
export const sessionTimings = {
  heartbeatIntervalMs: 10_000,
  expireAfterMs: 60_000,
  cacheGraceMs: 5 * 60_000,
} as const

/** No heartbeat for `expireAfterMs`: the session is over even if nobody said so. */
export const isExpired = (session: PlaybackSession, now: Date): boolean =>
  session.endedAt === undefined &&
  now.getTime() - session.lastHeartbeatAt.getTime() >= sessionTimings.expireAfterMs

export type NewPlaybackSession = Omit<PlaybackSession, 'accountId' | 'endedAt'>

/**
 * Sources (by library or root) or items about to be deleted; profiles about to be deleted; an
 * account about to be deleted or disabled.
 */
export type PlaybackScope =
  | { libraryId: string }
  | { rootIds: readonly string[] }
  | { sourceIds: readonly string[] }
  | { itemIds: readonly string[] }
  | { profileIds: readonly string[] }
  | { accountId: string }

/**
 * Ends cleanly (ffmpeg stopped, player told) the active sessions on sources or items about to be
 * deleted: the SQL cascade would drop their rows and nothing would stop their ffmpeg after (§10.6).
 * Called by the library and scanner use cases before they delete, and by the account and profile
 * use cases before a deletion or a deactivation (§14).
 */
export type PlaybackSessionTerminator = { endWithin: (scope: PlaybackScope) => void }

export type PlaybackSessionRepository = {
  insert: (session: NewPlaybackSession) => void
  /** With the account of its auth session. */
  findById: (id: string) => PlaybackSession | undefined
  heartbeat: (input: { id: string; at: Date; positionMs: number }) => void
  end: (input: { id: string; at: Date }) => void
  /** Sessions not ended whose last heartbeat is at or before `notAfter`. */
  listStale: (input: { notAfter: Date }) => PlaybackSession[]
  listActive: () => PlaybackSession[]
  /** Active sessions on a source of the library / roots, or on one of the items. */
  listActiveWithin: (scope: PlaybackScope) => PlaybackSession[]
}

export type TerminationReason = 'admin' | 'timeout' | 'ended'
