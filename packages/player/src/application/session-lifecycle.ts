import type { PlaybackHeartbeatBody, PlaybackSessionDto } from '@projo/shared/api/playback'

import type { PlayerEngine } from '../core/engine.ts'
import {
  type Heartbeat,
  type HeartbeatTransport,
  startHeartbeat,
  type Timers,
} from '../core/heartbeat.ts'
import type { MediaEventType } from '../core/media-state.ts'
import type { SessionEnds } from '../core/session-ends.ts'
import { itemPositionMs } from '../core/timeline.ts'
import type { PageLifecycle } from './ports.ts'

export type SessionLifecycle = {
  heartbeat: Heartbeat
  teardown: () => PlaybackHeartbeatBody
  dispose: () => void
}

/**
 * One playback session on screen (§10.6): the stream attached, a heartbeat
 * every interval and on pause, seek and end, a beacon when the page goes away.
 * `teardown` stops it all and gives the last position; `dispose` also ends the
 * session on the next tick unless the same session is retained again first
 * (a remount), and only once.
 */
export const startSessionLifecycle = ({
  session,
  engine,
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
  engine: Pick<PlayerEngine, 'read' | 'events'>
  page: PageLifecycle
  attach: () => () => void
  transport: HeartbeatTransport
  timers: Timers
  ends: Pick<SessionEnds, 'retain' | 'release' | 'endOnce'>
  onHeartbeatFailure: (failure: unknown) => void
  onEnded: () => void
  onPlaying: () => void
  onLoaded: () => void
  onVolumeChange: () => void
  onPosition: (positionMs: number) => void
  onLetGo: () => void
}): SessionLifecycle => {
  ends.retain(session.id)
  const detach = attach()
  const heartbeat = startHeartbeat({
    sessionId: session.id,
    intervalMs: session.heartbeatIntervalMs,
    read: () => {
      const media = engine.read()
      return {
        positionMs: media.ready
          ? itemPositionMs(session, media.currentTime)
          : session.startPositionMs,
        paused: media.paused,
      }
    },
    transport,
    timers,
    onFailure: onHeartbeatFailure,
  })
  const beat = () => {
    if (engine.read().ready) heartbeat.beat()
  }
  const ended = () => {
    beat()
    onEnded()
  }
  const track = () => {
    const media = engine.read()
    if (media.ready) onPosition(itemPositionMs(session, media.currentTime))
  }
  const listeners: Partial<Record<MediaEventType, () => void>> = {
    pause: beat,
    seeked: beat,
    ended,
    volumechange: onVolumeChange,
    timeupdate: track,
    playing: onPlaying,
    loadedmetadata: onLoaded,
  }
  const unsubscribe = engine.events.subscribe((event) => listeners[event.type]?.())
  const stopHide = page.onHide(() => heartbeat.close())

  let last: PlaybackHeartbeatBody | undefined
  const teardown = (): PlaybackHeartbeatBody => {
    if (last !== undefined) return last
    last = heartbeat.halt()
    unsubscribe()
    stopHide()
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
