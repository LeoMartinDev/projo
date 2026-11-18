import type { TvRendition } from '@projo/shared/api/tv'

/** A viewer watching a channel (§29.4); kept in memory, like the streams. */
export type LiveSession = {
  id: string
  channelId: string
  accountId: string
  profileId: string
  authSessionId: string
  rendition: TvRendition
  /** Hash of the capability secret of the stream URL (§20). */
  streamSecretHash: string
  startedAt: Date
  lastHeartbeatAt: Date
  /** Its viewer paused since (its heartbeats say so, §29.4); absent while it plays. */
  pausedSince?: Date
}

export const liveSessionTimings = {
  heartbeatIntervalMs: 10_000,
  expireAfterMs: 60_000,
} as const

export const isLiveSessionExpired = (session: LiveSession, now: Date): boolean =>
  now.getTime() - session.lastHeartbeatAt.getTime() >= liveSessionTimings.expireAfterMs

export type LiveSessionRepository = {
  insert: (session: LiveSession) => void
  findById: (id: string) => LiveSession | undefined
  /** `paused`: sets `pausedSince` (kept while paused), else clears it. */
  heartbeat: (input: { id: string; at: Date; paused?: boolean }) => void
  /** A session whose channel had to be probed first moves to the rendition its probe chose. */
  setRendition: (input: { id: string; rendition: TvRendition }) => void
  remove: (id: string) => void
  /** Newest first. */
  list: () => LiveSession[]
}

/** A live session as the admin's active sessions show it. */
export type ActiveLiveSessionView = {
  id: string
  account: { id: string; name: string }
  profile: { id: string; name: string; color: string }
  channel: { id: string; name: string; number?: number }
  rendition: TvRendition
  device?: string
  startedAt: Date
  lastHeartbeatAt: Date
  pausedSince?: Date
}

/** Names of who watches what, read for the admin's list. */
export type LiveSessionDirectory = {
  /** The views of the sessions whose account, profile and channel still exist. */
  describe: (sessions: readonly LiveSession[]) => ActiveLiveSessionView[]
}
