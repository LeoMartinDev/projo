import type { PlaybackHeartbeatBody } from '@projo/shared/api/playback'

export type HeartbeatTransport = {
  send: (sessionId: string, body: PlaybackHeartbeatBody) => Promise<unknown>
  beacon: (sessionId: string, body: PlaybackHeartbeatBody) => void
  end: (sessionId: string) => Promise<unknown>
}

export type Timers = {
  setInterval: (callback: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

export type PlaybackPosition = { positionMs: number; paused: boolean }

export type Heartbeat = {
  beat: () => void
  close: () => void
  halt: () => PlaybackHeartbeatBody
}

export const endSession = async (
  transport: HeartbeatTransport,
  sessionId: string,
  last: PlaybackHeartbeatBody,
): Promise<void> => {
  await transport.send(sessionId, last).catch(() => undefined)
  await transport.end(sessionId).catch(() => undefined)
}

export const sessionTimedOut = (
  cause: { code: string } | { reason: 'admin' | 'timeout' | 'ended' },
): boolean =>
  'code' in cause
    ? cause.code === 'playback/session_not_found' || cause.code === 'playback/session_expired'
    : cause.reason === 'timeout'

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
