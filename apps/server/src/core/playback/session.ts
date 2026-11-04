import type { PlaybackMode, PlaybackQuality } from '@projo/shared/api/playback'

export type PlaybackSession = {
  id: string
  profileId: string
  authSessionId: string
  accountId: string
  sourceId: string
  itemId: string
  mode: PlaybackMode
  quality?: PlaybackQuality
  audioStream?: number
  subtitleTrackId?: string
  burnIn: boolean
  audioDelivery?: 'copy' | 'aac'
  streamSecretHash?: string
  startedAt: Date
  lastHeartbeatAt: Date
  positionMs: number
  endedAt?: Date
}

export const sessionTimings = {
  heartbeatIntervalMs: 10_000,
  expireAfterMs: 60_000,
  cacheGraceMs: 5 * 60_000,
} as const

export const isExpired = (session: PlaybackSession, now: Date): boolean =>
  session.endedAt === undefined &&
  now.getTime() - session.lastHeartbeatAt.getTime() >= sessionTimings.expireAfterMs

export type NewPlaybackSession = Omit<PlaybackSession, 'accountId' | 'endedAt'>

export type PlaybackScope =
  | { libraryId: string }
  | { rootIds: readonly string[] }
  | { sourceIds: readonly string[] }
  | { itemIds: readonly string[] }
  | { profileIds: readonly string[] }
  | { accountId: string }

export type PlaybackSessionTerminator = { endWithin: (scope: PlaybackScope) => void }

export type PlaybackSessionRepository = {
  insert: (session: NewPlaybackSession) => void
  findById: (id: string) => PlaybackSession | undefined
  heartbeat: (input: { id: string; at: Date; positionMs: number }) => void
  end: (input: { id: string; at: Date }) => void
  listStale: (input: { notAfter: Date }) => PlaybackSession[]
  listActive: () => PlaybackSession[]
  listActiveWithin: (scope: PlaybackScope) => PlaybackSession[]
}

export type TerminationReason = 'admin' | 'timeout' | 'ended'
