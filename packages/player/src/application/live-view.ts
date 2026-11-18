import type { TvSessionDto } from '@projo/shared/api/tv'

import type { PlayerFailure } from '../core/failure.ts'
import { creationFailureReaction } from '../core/live.ts'
import type { MediaState } from '../core/media-state.ts'
import { reconnectDelay } from '../core/session-request.ts'
import type { Interruption } from './player-view.ts'

// What the live controller holds (§29.5); `undefined` values are explicit (they are reset).
export type LiveState = {
  // The channel on screen: the chrome names it at once, while its session is created.
  channelId: string
  creation: 'pending' | 'error' | 'ready'
  createFailure: PlayerFailure | undefined
  session: TvSessionDto | undefined
  interruption: Interruption | undefined
  reconnectAttempt: number
}

export type LiveView = {
  failure: PlayerFailure | undefined
  networkLost: boolean
  blocked: boolean
  loading: boolean
  // A session plays (or is paused): the controls act.
  playing: boolean
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
