import type { TvSessionDto } from '@projo/shared/api/tv'

import type { PlayerEngine, StreamFailure } from '../core/engine.ts'
import { type PlayerFailure, playerFailure, toPlayerFailure } from '../core/failure.ts'
import { type Heartbeat, type HeartbeatTransport, startHeartbeat } from '../core/heartbeat.ts'
import { heartbeatFailureReaction, liveHeartbeatIntervalMs } from '../core/live.ts'
import type { SessionEnds } from '../core/session-ends.ts'
import { reconnectDelay } from '../core/session-request.ts'
import { createStore, type ReadableStore } from '../core/store.ts'
import { keyedEffect } from './keyed-effect.ts'
import { type LiveState, type LiveView, liveView } from './live-view.ts'
import type { KeyValueStorage, LiveTvApi, PageLifecycle, Timers } from './ports.ts'
import { loadVolume, saveVolume } from './volume.ts'

export type LiveControllerDeps = {
  channelId: string
  engine: PlayerEngine
  api: LiveTvApi
  // The tab's live sessions: a session is ended once, and a new one is only created once the
  // previous ones are ended (a source with one connection can zap, §29.5).
  ends: SessionEnds
  timers: Timers
  storage: KeyValueStorage
  page: PageLifecycle
}

export type LiveController = ReadableStore<LiveState> & {
  // Starts (or resumes, after `stop`) the live session of the channel; `stop` leaves it.
  start: () => void
  stop: () => void
  view: () => LiveView
  // Another channel: the old session ends, then the new one is created.
  zap: (channelId: string) => void
  togglePlay: () => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  // The "Retry" of a blocking error.
  restart: () => void
  // The network may be back (online, page visible): reconnect now if it was lost.
  retryNetwork: () => void
  // `playback.session_terminated` from the server (§29.4).
  sessionTerminated: (payload: {
    playbackSessionId: string
    reason: 'admin' | 'timeout' | 'ended'
  }) => void
}

// Live sessions record no position: the bodies `SessionEnds` passes along are ignored.
const noPosition = { positionMs: 0, paused: true }

const initialState = (channelId: string): LiveState => ({
  channelId,
  creation: 'pending',
  createFailure: undefined,
  session: undefined,
  interruption: undefined,
  reconnectAttempt: 0,
})

type Attached = {
  session: TvSessionDto
  heartbeat: Heartbeat
  stopStream: () => void
  stopHide: () => void
}

/**
 * The live mode of the player (§29.5), for every engine: the channel's live session and its
 * heartbeat, zapping, pause and the return to the live edge, reconnection and blocking errors.
 */
export const createLiveController = ({
  channelId: initialChannel,
  engine,
  api,
  ends,
  timers,
  storage,
  page,
}: LiveControllerDeps): LiveController => {
  const store = createStore<LiveState>(initialState(initialChannel))
  const transport: HeartbeatTransport = {
    send: (sessionId) => api.heartbeat(sessionId),
    beacon: (sessionId) => {
      ends.forget(sessionId)
      api.endSession(sessionId).catch(() => undefined)
    },
    end: api.endSession,
  }
  let started = false
  let generation = 0
  let attached: Attached | undefined
  // A pause was seen since the stream was loaded: the next play rejoins the live edge.
  let pausedSinceLoad = false
  // The controller itself is stopping the stream (its events are not the viewer's).
  let reloading = false
  // A session ended by the server was replaced, and the new one has not played yet.
  let renewedOnEnd = false
  let unsubscribes: (() => void)[] = []
  const reconnectEffect = keyedEffect()

  const state = () => store.get()
  const view = () => liveView(state(), engine.state.get())

  const update = (patch: Partial<LiveState>) => {
    store.set({ ...state(), ...patch })
    react()
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  const loadStream = (session: TvSessionDto) => {
    pausedSinceLoad = false
    return engine.loadLive({ streamUrl: session.streamUrl, autoplay: true }, (failure) =>
      onStreamFailure(session, failure),
    )
  }

  const attach = (session: TvSessionDto) => {
    ends.retain(session.sessionId)
    const saved = loadVolume(storage)
    engine.setVolume(saved.volume, saved.muted)
    // The shared engine may keep a title's speed: live plays at 1 (§29.5).
    engine.setRate(1)
    const heartbeat = startHeartbeat({
      sessionId: session.sessionId,
      intervalMs: liveHeartbeatIntervalMs,
      read: () => ({ positionMs: 0, paused: engine.read().paused }),
      transport,
      timers,
      onFailure: (cause) => {
        const failure = toPlayerFailure(cause)
        const reaction = heartbeatFailureReaction(failure)
        if (reaction !== undefined) interrupt(failure, reaction === 'reconnect')
      },
    })
    attached = {
      session,
      heartbeat,
      stopStream: loadStream(session),
      stopHide: page.onHide(() => heartbeat.close()),
    }
  }

  // Stops the stream and the heartbeat; the session itself is left to the caller.
  const detach = (): string | undefined => {
    const current = attached
    if (current === undefined) return undefined
    attached = undefined
    current.heartbeat.halt()
    current.stopHide()
    reloading = true
    current.stopStream()
    reloading = false
    return current.session.sessionId
  }

  const endNow = (sessionId: string | undefined) => {
    if (sessionId !== undefined) void ends.endOnce(sessionId, noPosition)
  }

  // The creation under way: the next one waits for it, and for its session to end when it was
  // dropped (a zap during a creation never holds two of the provider's connections).
  let creating: Promise<void> = Promise.resolve()
  // The generation whose creation is under way: a remount (`stop` then `start`) adopts it.
  let inFlight: number | undefined

  const create = () => {
    const token = generation
    inFlight = token
    const { channelId } = state()
    const previous = creating
    // Still the channel on screen, with someone watching it.
    const wanted = () => token === generation && started
    const opened = async () => {
      await previous
      await ends.settled()
      if (!wanted()) return undefined
      const capabilities = await engine.clientCapabilities()
      if (!wanted()) return undefined
      return api.createSession(channelId, { capabilities })
    }
    const settle = () => {
      if (inFlight === token) inFlight = undefined
    }
    creating = opened().then(
      (session) => {
        settle()
        if (session === undefined) {
          // Given up while stopped, and started again since: create it after all.
          if (wanted()) create()
          return
        }
        if (token !== generation) {
          endNow(session.sessionId)
          return
        }
        update({ session, creation: 'ready', createFailure: undefined })
        if (started) attach(session)
        // Answered while stopped (a remount under way): kept a moment for `start`, as an
        // attached session is (§29.5).
        else ends.release(session.sessionId, () => ends.endOnce(session.sessionId, noPosition))
      },
      (cause: unknown) => {
        settle()
        // Left meanwhile: a later `start` creates it again.
        if (token !== generation || !started) return
        update({ creation: 'error', createFailure: toPlayerFailure(cause) })
      },
    )
  }

  // A new session of the channel on screen (zap, reconnection, retry); the old one ends first.
  const renew = (patch: Partial<LiveState> = {}) => {
    endNow(detach())
    generation += 1
    update({
      session: undefined,
      creation: 'pending',
      createFailure: undefined,
      interruption: undefined,
      ...patch,
    })
    if (started) create()
  }

  const interrupt = (failure: PlayerFailure, network: boolean) => {
    if (state().interruption !== undefined) return
    endNow(detach())
    update({
      interruption: network ? { kind: 'network', failure } : { kind: 'failure', failure },
    })
  }

  const onStreamFailure = (session: TvSessionDto, failure: StreamFailure) => {
    if (attached?.session !== session) return
    interrupt(
      playerFailure(0, 'playback/stream_failed', failure.message),
      failure.kind === 'network',
    )
  }

  const reconnect = () => {
    renew({ reconnectAttempt: state().reconnectAttempt + 1 })
  }

  // ── Reactions ───────────────────────────────────────────────────────────

  const react = () => {
    if (!started) return
    const { networkLost } = view()
    const { reconnectAttempt } = state()
    reconnectEffect.sync(networkLost ? reconnectAttempt : undefined, () => {
      if (!networkLost) return undefined
      const handle = timers.setTimeout(reconnect, reconnectDelay(reconnectAttempt) ?? 0)
      return () => timers.clearTimeout(handle)
    })
  }

  const onPause = () => {
    if (attached !== undefined && !reloading && engine.read().ready) pausedSinceLoad = true
    attached?.heartbeat.beat()
  }

  // Any play after a pause reloads the stream: playback resumes at the live edge (§29.5).
  const onPlay = () => {
    const current = attached
    if (current === undefined || reloading || !pausedSinceLoad) return
    reloading = true
    current.stopStream()
    reloading = false
    if (attached === current) current.stopStream = loadStream(current.session)
  }

  const onPlaying = () => {
    renewedOnEnd = false
    if (state().reconnectAttempt !== 0) update({ reconnectAttempt: 0 })
  }

  return {
    subscribe: store.subscribe,
    get: store.get,
    view,

    start: () => {
      if (started) return
      started = true
      unsubscribes = [
        engine.state.subscribe(react),
        engine.events.subscribe((event) => {
          if (event.type === 'pause') onPause()
          else if (event.type === 'play') onPlay()
          else if (event.type === 'playing') onPlaying()
          else if (event.type === 'volumechange') {
            const media = engine.read()
            saveVolume(storage, media.volume, media.muted)
          }
        }),
      ]
      const { session, creation, interruption } = state()
      if (session !== undefined && interruption === undefined) attach(session)
      else if (creation === 'pending' && inFlight !== generation) create()
      react()
    },

    stop: () => {
      if (!started) return
      started = false
      for (const unsubscribe of unsubscribes) unsubscribe()
      unsubscribes = []
      reconnectEffect.reset()
      const sessionId = detach()
      if (sessionId !== undefined)
        ends.release(sessionId, () => ends.endOnce(sessionId, noPosition))
    },

    zap: (channelId) => {
      if (channelId === state().channelId) return
      renewedOnEnd = false
      renew({ channelId, reconnectAttempt: 0 })
    },

    togglePlay: () => {
      if (attached === undefined) return
      const media = engine.read()
      if (media.paused || media.ended) engine.play()
      else engine.pause()
    },
    setVolume: (volume) => {
      const level = Math.min(1, Math.max(0, volume))
      engine.setVolume(level, level === 0)
    },
    toggleMute: () => {
      const media = engine.read()
      if (media.muted) engine.setVolume(media.volume === 0 ? 0.5 : media.volume, false)
      else engine.setVolume(media.volume, true)
    },

    restart: () => {
      renewedOnEnd = false
      renew({ reconnectAttempt: 0 })
    },
    retryNetwork: () => {
      if (view().networkLost) reconnect()
    },
    sessionTerminated: ({ playbackSessionId, reason }) => {
      const { session } = state()
      if (session === undefined || session.sessionId !== playbackSessionId) return
      if (ends.isLetGo(playbackSessionId)) return
      ends.forget(playbackSessionId)
      if (attached?.session === session) detach()
      // The server ends a session whose stream failed or whose channel went (`ended`) just before
      // answering its heartbeat with the code: a new session surfaces that code. Once only: ended
      // again before playing, it was not the stream.
      const reconnects = reason === 'timeout' || (reason === 'ended' && !renewedOnEnd)
      if (reason === 'ended') renewedOnEnd = true
      update({
        interruption: reconnects
          ? {
              kind: 'network',
              failure: playerFailure(404, 'tv/session_not_found', `live session ${reason}`),
            }
          : { kind: 'terminated', reason },
      })
    },
  }
}
