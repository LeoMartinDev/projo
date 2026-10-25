import type { PlaybackHeartbeatBody } from '@projo/shared/api/playback'

/**
 * Heartbeat cycle of a playback session (§10.6): every `intervalMs` (paused or not, so the
 * session does not time out during a long pause), and right away on pause and seek. On page
 * close the last position goes through `navigator.sendBeacon`; leaving the player sends a last
 * heartbeat then `DELETE`s the session. Transport and timers are injected (tested in Bun).
 */
export type HeartbeatTransport = {
  /** `PUT /playback/sessions/:id/heartbeat`. Rejects with an `ApiFailure`. */
  send: (sessionId: string, body: PlaybackHeartbeatBody) => Promise<unknown>
  /** `navigator.sendBeacon` on `POST /playback/sessions/:id/heartbeat`. */
  beacon: (sessionId: string, body: PlaybackHeartbeatBody) => void
  /** `DELETE /playback/sessions/:id`. */
  end: (sessionId: string) => Promise<unknown>
}

export type Timers = {
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

export type PlaybackPosition = { positionMs: number; paused: boolean }

export type Heartbeat = {
  /** Sends the position now (pause, seek, track change). */
  beat: () => void
  /** Page is going away: last position by beacon, timer stopped, session left to time out. */
  close: () => void
  /**
   * Stops the timer without any request and returns the last position. Leaving the player then
   * calls `endSession` (deferred, so a React StrictMode remount can keep the session).
   */
  halt: () => PlaybackHeartbeatBody
}

/** Leaving the player: last heartbeat, then `DELETE`; each step tolerates failure. */
export const endSession = async (
  transport: HeartbeatTransport,
  sessionId: string,
  last: PlaybackHeartbeatBody,
): Promise<void> => {
  await transport.send(sessionId, last).catch(() => undefined)
  await transport.end(sessionId).catch(() => undefined)
}

export const toHeartbeatBody = ({
  positionMs,
  paused,
}: PlaybackPosition): PlaybackHeartbeatBody => ({
  positionMs: Math.max(0, Math.round(Number.isFinite(positionMs) ? positionMs : 0)),
  paused,
})

export const startHeartbeat = ({
  sessionId,
  intervalMs,
  read,
  transport,
  timers,
  onFailure,
}: {
  sessionId: string
  intervalMs: number
  read: () => PlaybackPosition
  transport: HeartbeatTransport
  timers: Timers
  onFailure: (failure: unknown) => void
}): Heartbeat => {
  let running = true
  const body = () => toHeartbeatBody(read())
  const beat = () => {
    if (!running) return
    transport.send(sessionId, body()).catch((failure: unknown) => {
      if (running) onFailure(failure)
    })
  }
  const handle = timers.setInterval(beat, intervalMs)
  const halt = () => {
    running = false
    timers.clearInterval(handle)
  }

  return {
    beat,
    close: () => {
      if (!running) return
      halt()
      transport.beacon(sessionId, body())
    },
    halt: () => {
      const last = body()
      halt()
      return last
    },
  }
}
