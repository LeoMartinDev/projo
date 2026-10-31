import type { PlaybackHeartbeatBody, PlaybackSessionDto } from '@projo/shared/api/playback'

import {
  type Heartbeat,
  type HeartbeatTransport,
  startHeartbeat,
  type Timers,
} from './heartbeat.ts'
import type { SessionEnds } from './session-ends.ts'
import { itemPositionMs } from './timeline.ts'

/**
 * The life of a playback session in the player (§10.6), outside React: created (and ended at once
 * when the player left meanwhile), attached to `<video>`, kept alive by the heartbeat, torn down
 * (a switch or leaving), then released: ended on the next tick unless a remounted player retains
 * it (StrictMode). `PlayerPage` wires it to the real stream, transport and timers; the tests use
 * fakes.
 */

/** What the lifecycle reads and listens to on `<video>`. */
export type MediaElementLike = Pick<
  HTMLVideoElement,
  'readyState' | 'currentTime' | 'paused' | 'addEventListener' | 'removeEventListener'
>

/** The window: `pagehide` closes the session by beacon. */
export type PageLike = Pick<Window, 'addEventListener' | 'removeEventListener'>

/**
 * `queryFn` of the session query. The query is aborted when the player unmounts before the answer
 * (leaving while it loads, the next episode): it drops the result, so nobody else would end that
 * session, which would then hold a transcode slot for 60 s.
 */
export const createSessionUnlessLeft = async <T extends { session: PlaybackSessionDto }>({
  create,
  signal,
  endOnce,
}: {
  create: () => Promise<T>
  signal: AbortSignal
  endOnce: SessionEnds['endOnce']
}): Promise<T> => {
  const started = await create()
  if (signal.aborted)
    void endOnce(started.session.id, {
      positionMs: started.session.startPositionMs,
      paused: true,
    })
  return started
}

export type SessionLifecycle = {
  heartbeat: Heartbeat
  /** Stops the heartbeat, the listeners and the stream, once; returns the last position. */
  teardown: () => PlaybackHeartbeatBody
  /** Leaving (effect cleanup): `teardown`, then the session is released and ended. */
  dispose: () => void
}

export const startSessionLifecycle = ({
  session,
  video,
  page,
  attach,
  transport,
  timers,
  ends,
  onHeartbeatFailure,
  onEnded,
  onPlaying,
  onLoaded,
  onVolumeChange,
  onPosition,
  onLetGo,
}: {
  session: PlaybackSessionDto
  video: MediaElementLike
  page: PageLike
  /** Plugs the stream in; returns its idempotent detach (`attachStream`). */
  attach: () => () => void
  transport: HeartbeatTransport
  timers: Timers
  ends: Pick<SessionEnds, 'retain' | 'release' | 'endOnce'>
  onHeartbeatFailure: (failure: unknown) => void
  /** The stream played to its end (after a last heartbeat). */
  onEnded: () => void
  onPlaying: () => void
  onLoaded: () => void
  onVolumeChange: () => void
  /** Item position of each `timeupdate` once the stream has data. */
  onPosition: (positionMs: number) => void
  /** The session is let go server side: progress changed. */
  onLetGo: () => void
}): SessionLifecycle => {
  ends.retain(session.id)
  const detach = attach()
  const heartbeat = startHeartbeat({
    sessionId: session.id,
    intervalMs: session.heartbeatIntervalMs,
    // Before the first frame currentTime is 0: report the resume point, not the start.
    read: () => ({
      positionMs:
        video.readyState > 0 ? itemPositionMs(session, video.currentTime) : session.startPositionMs,
      paused: video.paused,
    }),
    transport,
    timers,
    onFailure: onHeartbeatFailure,
  })
  const beat = () => {
    if (video.readyState > 0) heartbeat.beat()
  }
  const ended = () => {
    beat()
    onEnded()
  }
  const close = () => heartbeat.close()
  const track = () => {
    if (video.readyState > 0) onPosition(itemPositionMs(session, video.currentTime))
  }
  const listeners: [string, () => void][] = [
    ['pause', beat],
    ['seeked', beat],
    ['ended', ended],
    ['volumechange', onVolumeChange],
    ['timeupdate', track],
    ['playing', onPlaying],
    ['loadedmetadata', onLoaded],
  ]
  for (const [type, listener] of listeners) video.addEventListener(type, listener)
  page.addEventListener('pagehide', close)

  let last: PlaybackHeartbeatBody | undefined
  const teardown = (): PlaybackHeartbeatBody => {
    if (last !== undefined) return last
    last = heartbeat.halt()
    for (const [type, listener] of listeners) video.removeEventListener(type, listener)
    page.removeEventListener('pagehide', close)
    detach()
    return last
  }
  return {
    heartbeat,
    teardown,
    dispose: () => {
      const position = teardown()
      ends.release(session.id, () => {
        const ending = ends.endOnce(session.id, position)
        void ending.then(onLetGo)
        return ending
      })
    },
  }
}
