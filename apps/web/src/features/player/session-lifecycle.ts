import type { PlaybackHeartbeatBody, PlaybackSessionDto } from '@projo/shared/api/playback'

import {
  type Heartbeat,
  type HeartbeatTransport,
  startHeartbeat,
  type Timers,
} from './heartbeat.ts'
import type { SessionEnds } from './session-ends.ts'
import { itemPositionMs } from './timeline.ts'

export type MediaElementLike = Pick<
  HTMLVideoElement,
  'readyState' | 'currentTime' | 'paused' | 'addEventListener' | 'removeEventListener'
>

export type PageLike = Pick<Window, 'addEventListener' | 'removeEventListener'>

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
  teardown: () => PlaybackHeartbeatBody
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
