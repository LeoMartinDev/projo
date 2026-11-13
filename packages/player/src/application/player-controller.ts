import type {
  AudioTrackDto,
  PlaybackHeartbeatBody,
  PlaybackQuality,
  PlaybackSessionDto,
  SubtitleTrackDto,
  TrackPreferencesBody,
} from '@projo/shared/api/playback'

import type { PlayerEngine } from '../core/engine.ts'
import type { MediaSnapshot } from '../core/media-state.ts'
import { type PlayerFailure, playerFailure, toPlayerFailure } from '../core/failure.ts'
import {
  endSession,
  type Heartbeat,
  type HeartbeatTransport,
  sessionTimedOut,
} from '../core/heartbeat.ts'
import { countdownFor, ticked } from '../core/next-up.ts'
import {
  autoSkipTarget,
  segmentKey,
  type SkippableSegment,
  skippableAt,
} from '../core/segment-skip.ts'
import type { SessionEnds } from '../core/session-ends.ts'
import {
  initialRequest,
  nextRequest,
  reconnectDelay,
  retriedRequest,
  type SessionChange,
  type SessionRequest,
  toCreateBody,
} from '../core/session-request.ts'
import { createStore, type ReadableStore } from '../core/store.ts'
import { needsNewSession, type SubtitleChoice, toggledSubtitle } from '../core/subtitles.ts'
import { itemPositionMs, nextPart, seekTargetFor, segmentAt } from '../core/timeline.ts'
import {
  memoryAtOpen,
  preferencesOf,
  profileDefaultsFor,
  selectionOf,
  serialTasks,
  type TrackKind,
  toastAutoHideMs,
  toastForChange,
  toastHideDelay,
  undoActionFor,
} from '../core/track-memory.ts'
import {
  initialPlayerContext,
  type PlayerContext,
  type PlayerState,
  type PlayerView,
  playerView,
} from './player-view.ts'
import type { Clock, KeyValueStorage, PageLifecycle, PlaybackApi, Timers } from './ports.ts'
import { type SessionLifecycle, startSessionLifecycle } from './session-lifecycle.ts'
import { loadVolume, saveVolume } from './volume.ts'

export const endedReturnDelayMs = 5000
export const countdownTickMs = 250
export const subtitleReloadDelayMs = 800

export const heartbeatTransportOf = (api: PlaybackApi): HeartbeatTransport => ({
  send: api.heartbeat,
  beacon: api.beacon,
  end: api.endSession,
})

// Ends a session with its last position (heartbeat, then DELETE), never failing.
export const endPlaybackSession = (
  api: PlaybackApi,
  sessionId: string,
  last: PlaybackHeartbeatBody,
): Promise<void> => endSession(heartbeatTransportOf(api), sessionId, last)

export type PlayerControllerDeps = {
  itemId: string
  fromStart: boolean
  engine: PlayerEngine
  api: PlaybackApi
  // Shared by every player of the app: a session is ended once, and a new one
  // is only created once the previous ones are ended.
  ends: SessionEnds
  timers: Timers
  clock: Clock
  storage: KeyValueStorage
  page: PageLifecycle
  subtitleDelayMs: number
  // A session was ended and its progress written (to refresh the catalogue).
  onLetGo: () => void
  // A new session replaces the current one (the page closes its menus).
  onSwitch: () => void
  // The next episode's countdown reached 0.
  onPlayNext: () => void
  // The item ended without a next one, `endedReturnDelayMs` ago.
  onExit: () => void
}

const initialState = (fromStart: boolean): PlayerState => ({
  request: initialRequest(fromStart),
  creation: 'pending',
  createFailure: undefined,
  session: undefined,
  subtitles: 'overlay',
  interruption: undefined,
  reconnectAttempt: 0,
  switching: undefined,
  audioChoice: undefined,
  subtitleChoice: undefined,
  lastSubtitleId: undefined,
  subtitlesChosen: false,
  rate: 1,
  toast: undefined,
  memory: undefined,
  skipEntry: undefined,
  skipped: undefined,
  creditsDismissed: false,
  countdown: undefined,
})

const unset = Symbol('unset')

// A side effect keyed by a value, like a React effect: started when the key
// changes, the previous one cleaned up first.
const keyedEffect = () => {
  let key: unknown = unset
  let cleanup: (() => void) | undefined
  return {
    sync: (next: unknown, start: () => (() => void) | undefined) => {
      if (Object.is(next, key)) return
      key = next
      const previous = cleanup
      cleanup = undefined
      previous?.()
      cleanup = start()
    },
    reset: () => {
      key = unset
      const previous = cleanup
      cleanup = undefined
      previous?.()
    },
  }
}

export type PlayerController = ReadableStore<PlayerState> & {
  // Starts (or resumes, after `stop`) the playback of the item; `stop` ends it.
  start: () => void
  stop: () => void
  setContext: (context: PlayerContext) => void
  view: () => PlayerView
  currentPositionMs: () => number
  togglePlay: () => void
  seekToItem: (positionMs: number) => void
  seekBy: (deltaMs: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setRate: (rate: number) => void
  setSubtitleDelay: (delayMs: number) => void
  chooseAudio: (track: AudioTrackDto) => void
  chooseSubtitle: (choice: SubtitleChoice) => void
  toggleSubtitles: () => void
  chooseQuality: (quality: PlaybackQuality) => void
  chooseVersion: (sourceId: string) => void
  skipOver: (segment: SkippableSegment) => void
  undoSkip: () => void
  skipSegment: () => void
  watchCredits: () => void
  setProfileDefault: () => void
  undoMemory: () => void
  // The "Retry" of a blocking error.
  restart: () => void
  // The network may be back (online, page visible): reconnect now if it was lost.
  retryNetwork: () => void
  // `playback.session_terminated` from the server (§10.6).
  sessionTerminated: (payload: {
    playbackSessionId: string
    reason: 'admin' | 'timeout' | 'ended'
  }) => void
}

/**
 * The playback logic of the player, for every engine (§10.6, §10.7, §11.3,
 * §12.4): sessions and their heartbeats, track, quality, version and part
 * changes, reconnection, track memory, segment skips and the next episode.
 */
export const createPlayerController = ({
  itemId,
  fromStart,
  engine,
  api,
  ends,
  timers,
  clock,
  storage,
  page,
  subtitleDelayMs,
  onLetGo,
  onSwitch,
  onPlayNext,
  onExit,
}: PlayerControllerDeps): PlayerController => {
  const store = createStore<PlayerState>(initialState(fromStart))
  const transport = heartbeatTransportOf(api)
  let context = initialPlayerContext
  let started = false
  let generation = 0
  let subtitleDelay = subtitleDelayMs
  let lifecycle: SessionLifecycle | undefined
  let teardown: (() => PlaybackHeartbeatBody) | undefined
  let heartbeat: Heartbeat | undefined
  let openingMemory: { value: TrackPreferencesBody | undefined } | undefined
  let lastPositionMs: number | undefined
  let startPaused = false
  let played = false
  let pendingAudioMemory: { attempt: number } | undefined
  let unsubscribes: (() => void)[] = []
  const handledSegments = new Set<string>()
  const writeMemory = serialTasks()

  const state = () => store.get()
  const view = () => playerView(state(), engine.state.get(), context)

  const effects = {
    reconnect: keyedEffect(),
    toast: keyedEffect(),
    skipped: keyedEffect(),
    countdownReset: keyedEffect(),
    countdown: keyedEffect(),
    launch: keyedEffect(),
    credits: keyedEffect(),
    endedExit: keyedEffect(),
  }

  let reconciling = false
  let again = false
  const reconcile = () => {
    if (!started) return
    if (reconciling) {
      again = true
      return
    }
    reconciling = true
    do {
      again = false
      react()
    } while (again)
    reconciling = false
  }

  const update = (patch: Partial<PlayerState>) => {
    store.set({ ...state(), ...patch })
    reconcile()
  }

  const timeout = (callback: () => void, ms: number) => {
    const handle = timers.setTimeout(callback, ms)
    return () => timers.clearTimeout(handle)
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  const interrupt = (failure: PlayerFailure, network: boolean) => {
    if (state().interruption !== undefined) return
    update({
      interruption: network ? { kind: 'network', failure } : { kind: 'failure', failure },
    })
  }

  const subtitleTrackOf = (session: PlaybackSessionDto, id: string | undefined) =>
    session.subtitleTracks.find((track) => track.id === id)

  const restoreVolume = () => {
    const saved = loadVolume(storage)
    engine.setVolume(saved.volume, saved.muted)
  }

  const attach = (session: PlaybackSessionDto) => {
    if (openingMemory === undefined) openingMemory = { value: memoryAtOpen(session) }
    restoreVolume()
    engine.setRate(state().rate)
    const opened = startSessionLifecycle({
      session,
      engine,
      page,
      attach: () =>
        engine.load(
          {
            session,
            startSeconds: Math.max(0, session.startPositionMs - session.partOffsetMs) / 1000,
            autoplay: !startPaused,
            subtitleDelayMs: subtitleDelay,
          },
          (failure) =>
            interrupt(playerFailure(0, 'playback/stream_failed', failure.message), failure.network),
        ),
      transport,
      timers,
      ends,
      onHeartbeatFailure: (cause) => {
        const failure = toPlayerFailure(cause)
        if (sessionTimedOut(failure)) interrupt(failure, true)
      },
      onEnded: () => {
        const current = state().session
        const following = current === undefined ? undefined : nextPart(current)
        if (following !== undefined) void switchSession({ type: 'part', part: following })
      },
      onPlaying: () => {
        played = true
        const { reconnectAttempt, switching } = state()
        if (reconnectAttempt !== 0 || switching !== undefined)
          update({ reconnectAttempt: 0, switching: undefined })
      },
      onLoaded: () => engine.setRate(state().rate),
      onVolumeChange: () => {
        const media = engine.read()
        saveVolume(storage, media.volume, media.muted)
      },
      onPosition: (positionMs) => {
        lastPositionMs = positionMs
      },
      onLetGo,
    })
    lifecycle = opened
    heartbeat = opened.heartbeat
    teardown = opened.teardown
    engine.selectSubtitle(subtitleTrackOf(session, view().subtitleId))
    engine.setSubtitleDelay(subtitleDelay)
  }

  const detach = () => {
    const current = lifecycle
    lifecycle = undefined
    teardown = undefined
    heartbeat = undefined
    current?.dispose()
  }

  const remember = (kind: TrackKind, selection: Parameters<typeof preferencesOf>[0]) => {
    const current = preferencesOf(selection)
    const { toast, memory } = state()
    const previous = memory?.value ?? openingMemory?.value
    const next = toastForChange({
      previousToast: toast,
      memory: previous,
      kind,
      scope: context.scope,
      current,
    })
    update({ skipped: undefined, toast: next, memory: { value: current } })
    writeMemory(() => api.putTrackPreferences(itemId, current)).catch(() => failToast(next.id))
  }

  const failToast = (id: number) => {
    const shown = state().toast
    if (shown?.id === id) update({ toast: { ...shown, status: 'failed' } })
  }

  const rememberCascadeAudio = (opened: PlaybackSessionDto) => {
    const pending = pendingAudioMemory
    pendingAudioMemory = undefined
    if (pending?.attempt === state().request.attempt) remember('audio', selectionOf(opened))
  }

  const create = () => {
    const token = generation
    const { request } = state()
    const opened = async () => {
      await ends.settled()
      const capabilities = await engine.clientCapabilities()
      const session = await api.createSession({ ...toCreateBody(itemId, request), capabilities })
      return { session, subtitles: capabilities.subtitleDelivery ?? 'overlay' }
    }
    opened().then(
      ({ session, subtitles }) => {
        if (token !== generation || state().request !== request) {
          void ends.endOnce(session.id, { positionMs: session.startPositionMs, paused: true })
          return
        }
        update({ session, subtitles, creation: 'ready', createFailure: undefined })
        attach(session)
        rememberCascadeAudio(session)
        reconcile()
      },
      (cause: unknown) => {
        if (token !== generation || state().request !== request) return
        update({ creation: 'error', createFailure: toPlayerFailure(cause) })
      },
    )
  }

  const setRequest = (request: SessionRequest) => {
    detach()
    generation += 1
    update({ request, session: undefined, creation: 'pending', createFailure: undefined })
    if (started) create()
  }

  const currentPositionMs = () => {
    const media = engine.read()
    const { session } = state()
    return session !== undefined && media.ready
      ? itemPositionMs(session, media.currentTime)
      : (lastPositionMs ?? view().positionMs)
  }

  const switchSession = async (change: SessionChange) => {
    const current = state()
    const { session } = current
    if (session === undefined) return
    const at = currentPositionMs()
    const shown = view()
    update({
      switching: {
        positionMs: change.type === 'part' ? change.part.offsetMs : at,
        totalMs: shown.totalMs,
      },
    })
    onSwitch()
    const last = teardown?.() ?? { positionMs: at, paused: false }
    startPaused = change.type === 'retry' && last.paused === true && played
    const next = nextRequest({
      request: current.request,
      session,
      tracks: {
        audioStreamIndex: shown.audioIndex,
        subtitleTrackId: shown.subtitleId,
        subtitlesChosen: current.subtitlesChosen,
      },
      change,
      positionMs: at,
    })
    await ends.endOnce(session.id, last)
    update({ interruption: undefined })
    setRequest(next)
  }

  const reconnect = () => {
    const current = state()
    update({ reconnectAttempt: current.reconnectAttempt + 1 })
    if (current.session !== undefined) {
      void switchSession({ type: 'retry' })
      return
    }
    update({ interruption: undefined })
    setRequest(retriedRequest(state().request, lastPositionMs))
  }

  // ── Seeking and segments (§12.4) ─────────────────────────────────────────

  const seekToItem = (target: number) => {
    const { session } = state()
    if (session === undefined) return
    const where = seekTargetFor(session, engine.state.get().duration * 1000, target)
    if (where.kind === 'stream') engine.seek(where.seconds)
    else void switchSession({ type: 'seek_part', part: where.part, positionMs: where.positionMs })
  }

  const skipOver = (segment: SkippableSegment) => {
    handledSegments.add(segmentKey(segment))
    update({ toast: undefined, skipped: { segment, id: (state().skipped?.id ?? 0) + 1 } })
    seekToItem(segment.endMs)
  }

  const onSegmentTime = (media: MediaSnapshot) => {
    const { session, skipEntry } = state()
    if (session === undefined || view().blocked || !media.ready) return
    const at = itemPositionMs(session, media.currentTime)
    const playing = skippableAt(session.segments, at)
    const key = playing === undefined ? undefined : segmentKey(playing)
    const entry =
      key === undefined ? undefined : skipEntry?.key === key ? skipEntry : { key, atMs: at }
    if (entry !== skipEntry) update({ skipEntry: entry })
    if (media.paused || media.seeking) return
    const target = autoSkipTarget({
      segments: session.segments,
      positionMs: at,
      autoSkipIntro: context.profile?.autoSkipIntro ?? false,
      handled: handledSegments,
    })
    if (target !== undefined) skipOver(target)
  }

  // ── Tracks (§11.3) ───────────────────────────────────────────────────────

  const chooseSubtitle = (choice: SubtitleChoice) => {
    const current = state()
    const { session } = current
    if (session === undefined) return
    const { subtitleId, audioIndex } = view()
    const id = choice.kind === 'off' ? undefined : choice.track.id
    if (id === subtitleId) return
    update({
      ...(subtitleId === undefined ? {} : { lastSubtitleId: subtitleId }),
      subtitlesChosen: true,
    })
    const track: SubtitleTrackDto | undefined = choice.kind === 'off' ? undefined : choice.track
    remember('subtitles', {
      audio: session.audioTracks.find((candidate) => candidate.index === audioIndex),
      subtitle: track,
    })
    if (needsNewSession(session, choice, current.subtitles)) {
      void switchSession({ type: 'subtitles', trackId: id ?? 'off' })
      return
    }
    update({ subtitleChoice: { sessionId: session.id, id } })
    engine.selectSubtitle(track)
    heartbeat?.beat()
  }

  // ── Reactions: what React effects did, keyed on the view ─────────────────

  const tick = (elapsedMs: number) => {
    const { trigger, countdownStart } = view()
    if (trigger === undefined) return
    update({
      countdown: ticked(countdownFor(state().countdown, trigger, countdownStart), elapsedMs),
    })
  }

  const react = () => {
    const current = state()
    const shown = view()
    effects.reconnect.sync(shown.networkLost ? current.reconnectAttempt : undefined, () =>
      shown.networkLost
        ? timeout(reconnect, reconnectDelay(current.reconnectAttempt) ?? 0)
        : undefined,
    )
    effects.toast.sync(current.toast, () => {
      const delay = current.toast === undefined ? undefined : toastHideDelay(current.toast)
      return delay === undefined ? undefined : timeout(() => update({ toast: undefined }), delay)
    })
    effects.skipped.sync(current.skipped, () =>
      current.skipped === undefined
        ? undefined
        : timeout(() => update({ skipped: undefined }), toastAutoHideMs),
    )
    const nextUpActive = shown.nextUpView !== 'none'
    effects.countdownReset.sync(nextUpActive, () =>
      nextUpActive ? () => update({ countdown: undefined }) : undefined,
    )
    effects.countdown.sync(shown.counting, () => {
      if (!shown.counting) return undefined
      let last = clock.now()
      const handle = timers.setInterval(() => {
        const now = clock.now()
        tick(now - last)
        last = now
      }, countdownTickMs)
      return () => timers.clearInterval(handle)
    })
    effects.launch.sync(shown.launch, () => {
      if (shown.launch) onPlayNext()
      return undefined
    })
    const creditsKey = shown.trigger?.kind === 'credits' ? shown.trigger.key : undefined
    effects.credits.sync(creditsKey, () => {
      if (creditsKey !== undefined) heartbeat?.beat()
      return undefined
    })
    const endedAlone = shown.itemEnded && context.next === 'none'
    effects.endedExit.sync(endedAlone, () =>
      endedAlone ? timeout(onExit, endedReturnDelayMs) : undefined,
    )
  }

  return {
    subscribe: store.subscribe,
    get: store.get,
    view,
    currentPositionMs,

    start: () => {
      if (started) return
      started = true
      unsubscribes = [
        engine.state.subscribe(reconcile),
        engine.events.subscribe((event) => {
          if (event.type === 'timeupdate') onSegmentTime(event.media)
        }),
      ]
      const { session, creation } = state()
      if (session !== undefined) attach(session)
      else if (creation === 'pending') create()
      reconcile()
    },

    stop: () => {
      if (!started) return
      started = false
      generation += 1
      for (const unsubscribe of unsubscribes) unsubscribe()
      unsubscribes = []
      for (const effect of Object.values(effects)) effect.reset()
      detach()
    },

    setContext: (next) => {
      context = next
      reconcile()
    },

    togglePlay: () => {
      const media = engine.read()
      if (media.paused || media.ended) engine.play()
      else engine.pause()
    },
    seekToItem,
    seekBy: (deltaMs) => seekToItem(currentPositionMs() + deltaMs),
    setVolume: (volume) => {
      const level = Math.min(1, Math.max(0, volume))
      engine.setVolume(level, level === 0)
    },
    toggleMute: () => {
      const media = engine.read()
      if (media.muted) engine.setVolume(media.volume === 0 ? 0.5 : media.volume, false)
      else engine.setVolume(media.volume, true)
    },
    setRate: (rate) => {
      update({ rate })
      engine.setRate(rate)
    },
    setSubtitleDelay: (delayMs) => {
      subtitleDelay = delayMs
      if (state().session !== undefined) engine.setSubtitleDelay(delayMs)
    },

    chooseAudio: (track) => {
      const current = state()
      const { session } = current
      const { audioIndex, subtitleId } = view()
      if (session === undefined || track.index === audioIndex) return
      const subtitle = subtitleTrackOf(session, subtitleId)
      if (engine.capabilities.switchesAudioInPlace) {
        remember('audio', { audio: track, subtitle })
        update({ audioChoice: { sessionId: session.id, index: track.index } })
        engine.selectAudio(track)
        heartbeat?.beat()
        return
      }
      if (current.subtitlesChosen) remember('audio', { audio: track, subtitle })
      else pendingAudioMemory = { attempt: current.request.attempt + 1 }
      void switchSession({ type: 'audio', index: track.index })
    },
    chooseSubtitle,
    toggleSubtitles: () => {
      const { session, lastSubtitleId } = state()
      if (session === undefined) return
      const choice = toggledSubtitle({
        tracks: session.subtitleTracks,
        selectedId: view().subtitleId,
        lastId: lastSubtitleId,
        preferredLanguage: context.profile?.subtitleLanguage,
      })
      if (choice !== undefined) chooseSubtitle(choice)
    },
    chooseQuality: (quality) => {
      const { session } = state()
      if (session !== undefined && quality !== session.quality)
        void switchSession({ type: 'quality', quality })
    },
    chooseVersion: (sourceId) => void switchSession({ type: 'version', sourceId }),

    skipOver,
    undoSkip: () => {
      const { skipped } = state()
      if (skipped === undefined) return
      const { segment } = skipped
      update({ skipped: undefined, skipEntry: { key: segmentKey(segment), atMs: segment.startMs } })
      seekToItem(segment.startMs)
    },
    skipSegment: () => {
      const { session } = state()
      if (session === undefined) return
      const at = currentPositionMs()
      const skippable = skippableAt(session.segments, at)
      if (skippable !== undefined) {
        skipOver(skippable)
        return
      }
      const segment = segmentAt(session.segments, at)
      if (segment !== undefined) seekToItem(segment.endMs)
    },
    watchCredits: () => update({ creditsDismissed: true }),

    setProfileDefault: () => {
      const { toast } = state()
      const { profile } = context
      if (toast === undefined || profile === undefined) return
      const body = profileDefaultsFor(toast.kind, toast.current, profile)
      if (body === undefined) return
      const id = toast.id
      update({ toast: { ...toast, status: 'defaulting' } })
      api.updateProfile(profile.id, body).then(
        () => {
          const shown = state().toast
          if (shown?.id === id) update({ toast: { ...shown, status: 'defaulted' } })
        },
        () => failToast(id),
      )
    },
    undoMemory: () => {
      const { toast } = state()
      if (toast === undefined) return
      const action = undoActionFor(toast.previous)
      const id = toast.id
      update({ memory: { value: toast.previous }, toast: { ...toast, status: 'undone' } })
      writeMemory(() =>
        action.type === 'delete'
          ? api.deleteTrackPreferences(itemId)
          : api.putTrackPreferences(itemId, action.body),
      ).catch(() => failToast(id))
    },

    restart: () => {
      update({ reconnectAttempt: 0 })
      const { session, interruption } = state()
      if (session !== undefined && interruption?.kind !== 'terminated') {
        void switchSession({ type: 'retry' })
        return
      }
      update({ interruption: undefined })
      setRequest(retriedRequest(state().request, lastPositionMs))
    },
    retryNetwork: () => {
      if (view().networkLost) reconnect()
    },
    sessionTerminated: (payload) => {
      const { session } = state()
      if (session === undefined || payload.playbackSessionId !== session.id) return
      if (ends.isLetGo(session.id)) return
      ends.forget(session.id)
      teardown?.()
      update({
        interruption: sessionTimedOut(payload)
          ? {
              kind: 'network',
              failure: playerFailure(410, 'playback/session_expired', 'playback session ended'),
            }
          : { kind: 'terminated', reason: payload.reason },
      })
    },
  }
}
