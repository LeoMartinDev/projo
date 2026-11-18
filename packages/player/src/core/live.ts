import type { PlayerFailure } from './failure.ts'

/** A live session's heartbeat (§29.4: gone after 60 s without one). */
export const liveHeartbeatIntervalMs = 10_000

/**
 * The channel `step` places from `current` in the TV page's order (§29.5), wrapping at both
 * ends; undefined when `current` is not listed or alone.
 */
export const adjacentChannel = (
  order: readonly string[],
  current: string,
  step: 1 | -1,
): string | undefined => {
  const index = order.indexOf(current)
  if (index === -1 || order.length < 2) return undefined
  return order[(index + step + order.length) % order.length]
}

/** What a failure does to a live session (§29.5): a new session, or a blocking error. */
export type LiveFailureReaction = 'reconnect' | 'block'

/** A creation refused: only a lost network is retried by itself. */
export const creationFailureReaction = (failure: PlayerFailure): LiveFailureReaction =>
  failure.code === 'network' ? 'reconnect' : 'block'

/**
 * A heartbeat refused: the session gone (expired) is replaced, a stream that failed or a
 * channel gone blocks; anything else (the network) waits for the next beat, the server keeping
 * the session 60 s.
 */
export const heartbeatFailureReaction = (
  failure: PlayerFailure,
): LiveFailureReaction | undefined => {
  if (failure.code === 'tv/session_not_found') return 'reconnect'
  if (failure.code === 'tv/stream_unavailable' || failure.code === 'tv/channel_not_found')
    return 'block'
  return undefined
}
