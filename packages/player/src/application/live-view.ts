import type { TvSessionDto } from '@projo/shared/api/tv'

import type { PlayerFailure } from '../core/failure.ts'
import { creationFailureReaction, type LiveGap, type LiveWindow } from '../core/live.ts'
import type { MediaState } from '../core/media-state.ts'
import { reconnectDelay } from '../core/session-request.ts'
import type { Interruption } from './player-view.ts'

// A short notice over the picture (§29.5): where a play after a long pause resumed.
export type LiveNotice = 'resumedOldest' | 'resumedLive'

// What the live controller holds (§29.5); `undefined` values are explicit (they are reset).
export type LiveState = {
  // The channel on screen: the chrome names it at once, while its session is created.
  channelId: string
  creation: 'pending' | 'error' | 'ready'
  createFailure: PlayerFailure | undefined
  session: TvSessionDto | undefined
  interruption: Interruption | undefined
  reconnectAttempt: number
  // The session's replay window as last read, and when (wall clock): timeshift when known.
  window: { window: LiveWindow; readAtMs: number } | undefined
  // A pause outlasted the window: the player ended its session; play starts a new one.
  released: boolean
  notice: LiveNotice | undefined
}

export type LiveView = {
  failure: PlayerFailure | undefined
  networkLost: boolean
  blocked: boolean
  loading: boolean
  // A session plays (or is paused): the controls act.
  playing: boolean
}

// The bar of the replay window (§29.5), on the wall clock.
export type LiveTimeline = {
  startMs: number
  edgeMs: number
  positionMs: number
  gaps: readonly LiveGap[]
  // How far behind the live point (0 at live).
  delayMs: number
  atLive: boolean
}

/**
 * Everything the live player shows, from the controller and the media: live, only `paused`,
 * `waiting` and `ready` count (duration and current time mean nothing, §29.5).
 */
export const liveView = (
  state: LiveState,
  media: Pick<MediaState, 'paused' | 'waiting' | 'ready'>,
): LiveView => {
  const { interruption } = state
  const failure =
    interruption?.kind === 'failure' || interruption?.kind === 'network'
      ? interruption.failure
      : state.creation === 'error'
        ? state.createFailure
        : undefined
  // A lost network reconnects (a new session), until the delays run out; anything else blocks.
  const networkLost =
    failure !== undefined &&
    (interruption === undefined
      ? creationFailureReaction(failure) === 'reconnect'
      : interruption.kind === 'network') &&
    reconnectDelay(state.reconnectAttempt) !== undefined
  const blocked = (failure !== undefined && !networkLost) || interruption?.kind === 'terminated'
  // Released after a long pause: shown as paused, play starts a new session.
  if (state.released && !blocked && !networkLost)
    return { failure, networkLost, blocked, loading: false, playing: true }
  const loading =
    !blocked &&
    (networkLost ||
      state.creation === 'pending' ||
      state.session === undefined ||
      (media.waiting && !media.paused) ||
      !media.ready)
  return {
    failure,
    networkLost,
    blocked,
    loading,
    playing: !blocked && state.session !== undefined && interruption === undefined,
  }
}
