import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { episodeLine, itemTitle } from '@projo/i18n/item-titles'
import type { ItemDetailDto, ItemSummaryDto } from '@projo/shared/api/catalog'
import type {
  AudioTrackDto,
  PlaybackHeartbeatBody,
  PlaybackQuality,
  PlaybackSessionDto,
  TrackPreferencesBody,
} from '@projo/shared/api/playback'

import { type ApiFailure, apiFailure, toApiFailure } from '../../shared/api/failure.ts'
import { useServerEvent } from '../../shared/events/events.ts'
import { formatClock } from '../../shared/format/format.ts'
import { useErrorMessage } from '../../shared/i18n/errors.ts'
import { pickActiveProfile } from '../../shared/session/active-profile.ts'
import { sessionQuery } from '../../shared/session/session.ts'
import {
  BackIcon,
  Forward10Icon,
  MutedIcon,
  PauseIcon,
  PlayIcon,
  Rewind10Icon,
  VolumeIcon,
} from '../../shared/ui/icons.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import { itemQuery } from '../catalog/queries.ts'
import { useUpdateProfile } from '../profiles/queries.ts'
import {
  documentPictureInPictureSupported,
  openDocumentPictureInPicture,
  showInDocumentPictureInPicture,
} from './document-pip.ts'
import { EpisodesPanel } from './EpisodesPanel.tsx'
import { nowPlayingOf } from './media-session.ts'
import { NextUpCard } from './NextUpCard.tsx'
import { type Heartbeat, sessionTimedOut, startHeartbeat } from './heartbeat.ts'
import {
  attachStream,
  createPlaybackSession,
  deleteTrackPreferences,
  endSessionOnce,
  fetchTrickplayIndex,
  forgetSession,
  isSessionLetGo,
  playbackTransport,
  preloadImages,
  putTrackPreferences,
  releaseSession,
  reloadStream,
  retainSession,
  type StreamFailure,
} from './playback.ts'
import {
  AirPlayIcon,
  ChaptersIcon,
  CornersIcon,
  CornersInIcon,
  EpisodesIcon,
  NextEpisodeIcon,
  PictureInPictureIcon,
  QualityIcon,
  SpeedIcon,
  SubtitlesIcon,
} from './player-icons.tsx'
import {
  ChaptersMenu,
  hasQualityChoice,
  LanguagesMenu,
  type LanguagesTab,
  type PlayerMenu,
  QualityMenu,
  SpeedMenu,
} from './PlayerMenus.tsx'
import {
  loadSubtitleSettings,
  saveSubtitleSettings,
  type SubtitleSettings,
} from './player-settings.ts'
import {
  type Countdown,
  countdownFor,
  countdownRatio,
  countdownStartMs,
  nextUpTriggerAt,
  nextUpVisible,
  secondsLeft,
  ticked,
} from './next-up.ts'
import {
  autoSkipTarget,
  segmentKey,
  skipButtonPhase,
  type SkippableSegment,
  skippableAt,
} from './segment-skip.ts'
import {
  initialRequest,
  nextRequest,
  reconnectDelay,
  retriedRequest,
  type SessionChange,
  type SessionRequest,
} from './session-request.ts'
import {
  commandFor,
  isDoubleTap,
  isVerticalDrag,
  type Tap,
  tapZone,
  volumeAfterDrag,
} from './shortcuts.ts'
import { SkippedToast, SkipSegmentButton } from './SkipSegment.tsx'
import { SubtitleOverlay } from './SubtitleOverlay.tsx'
import {
  needsNewSession,
  renditionLabel,
  type SubtitleChoice,
  toggledSubtitle,
  vttTrackOf,
  withSubtitleOffset,
} from './subtitles.ts'
import {
  chapterIndexAt,
  chaptersOnItem,
  currentPartDurationMs,
  itemPositionMs,
  nextPart,
  ratioOf,
  remainingMs,
  seekTargetFor,
  segmentAt,
  segmentZones,
  totalDurationMs,
} from './timeline.ts'
import { Timeline } from './Timeline.tsx'
import {
  memoryAtOpen,
  preferencesOf,
  profileDefaultsFor,
  selectionOf,
  serialTasks,
  type TrackKind,
  type TrackToast as TrackToastState,
  toastForChange,
  toastAutoHideMs,
  toastHideDelay,
  undoActionFor,
} from './track-memory.ts'
import { TrackToast } from './TrackToast.tsx'
import { sheetUrls, thumbnailAt } from './trickplay.ts'
import { useMediaSession } from './use-media-session.ts'
import { useNextEpisode } from './use-next-episode.ts'
import {
  pictureInPictureShowsTextTracks,
  pictureInPictureSupported,
  restoreVolume,
  saveVolume,
  seekTo,
  setPlaybackRate,
  setVolumeLevel,
  showAirPlayPicker,
  toggleFullscreen,
  toggleMuted,
  togglePictureInPicture,
  togglePlayback,
  useAirPlayAvailable,
  useIsFullscreen,
  usePictureInPicture,
  useVideoState,
  volumeSettable,
} from './video-state.ts'
import './player.css'

const seekStepMs = 10_000
const volumeStep = 0.1
const idleDelayMs = 3000
const endedReturnDelayMs = 5000
const hudDelayMs = 700
const countdownTickMs = 250

type Interruption =
  | { kind: 'failure'; failure: ApiFailure }
  /** Connection lost: retried automatically at the position (§10.7). */
  | { kind: 'network'; failure: ApiFailure }
  | { kind: 'terminated'; reason: 'admin' | 'timeout' | 'ended' }

type Overlay = PlayerMenu | 'episodes'

const useTitle = (item: ItemDetailDto | undefined) => {
  const { t } = useTranslation()
  if (item === undefined) return { title: '', subtitle: undefined }
  const title = itemTitle(t, item)
  if (item.kind !== 'episode') return { title, subtitle: undefined }
  return { title: item.series?.title ?? title, subtitle: episodeLine(t, item) }
}

const isEditable = (target: EventTarget | undefined) => {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true
  return (
    target.tagName === 'INPUT' &&
    !['range', 'checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type)
  )
}

const inOverlay = (target: EventTarget | undefined) =>
  target instanceof Element && (target.closest('[data-player-overlay]') ?? undefined) !== undefined

/**
 * Player (§10.7, artboards `Player` and `PlayerNext`): full-frame video, top (quit) and bottom
 * chrome fading after 3 s, the bar (buffer, segments, trickplay, remaining time), the controls
 * row and its menus (chapters, speed, quality, subtitles and audio), the episodes panel; parts
 * chained on the item timeline, track changes as new sessions (the old one deleted first), the
 * memory toast of §11.3, shortcuts and touch gestures; loading, buffering, network loss (resumed
 * at the position), transcode limit, admin stop, end of the item.
 */
export const PlayerPage = ({ itemId, fromStart }: { itemId: string; fromStart: boolean }) => {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const queryClient = useQueryClient()
  const item = useQuery(itemQuery(itemId))
  const me = useQuery(sessionQuery).data
  const profile = me?.status === 'signed_in' ? pickActiveProfile(me.me) : undefined
  const updateProfile = useUpdateProfile()
  const next = useNextEpisode(item.data)
  const { title, subtitle } = useTitle(item.data)

  const [request, setRequest] = useState<SessionRequest>(() => initialRequest(fromStart))
  const [interruption, setInterruption] = useState<Interruption>()
  const [reconnectAttempt, setReconnectAttempt] = useState(0)
  const [switching, setSwitching] = useState<{ positionMs: number; totalMs: number }>()
  const [idle, setIdle] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>()
  const [languagesTab, setLanguagesTab] = useState<LanguagesTab>('subtitles')
  const [subtitleChoice, setSubtitleChoice] = useState<{
    sessionId: string
    id: string | undefined
  }>()
  const [lastSubtitleId, setLastSubtitleId] = useState<string>()
  /** A subtitle track or "Off" picked in this playback: an audio change keeps it. */
  const [subtitlesChosen, setSubtitlesChosen] = useState(false)
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(loadSubtitleSettings)
  const [rate, setRate] = useState(1)
  const [toast, setToast] = useState<TrackToastState>()
  const [memory, setMemory] = useState<{ value: TrackPreferencesBody | undefined }>()
  const [writeMemory] = useState(serialTasks)
  const [nativeFullscreen, setNativeFullscreen] = useState(false)
  const [seekHud, setSeekHud] = useState<{ side: 'left' | 'right'; seconds: number; id: number }>()
  const [volumeHud, setVolumeHud] = useState<number>()
  /** Where the intro (or recap) button appeared: its 8 s run from there (§12.4). */
  const [skipEntry, setSkipEntry] = useState<{ key: string; atMs: number }>()
  /** "Intro skipped · Undo" after a jump over an intro or a recap. */
  const [skipped, setSkipped] = useState<{ segment: SkippableSegment; id: number }>()
  /** "Watch the credits": the card stays closed for that segment. */
  const [dismissedNextUp, setDismissedNextUp] = useState<ReadonlySet<string>>(() => new Set())
  const [countdown, setCountdown] = useState<Countdown>()
  /** Segments skipped once (or brought back) in this playback: never skipped automatically again. */
  const handledSegmentsRef = useRef(new Set<string>())

  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const teardownRef = useRef<(() => PlaybackHeartbeatBody) | undefined>(undefined)
  const heartbeatRef = useRef<Heartbeat | undefined>(undefined)
  const openingMemoryRef = useRef<{ value: TrackPreferencesBody | undefined } | undefined>(
    undefined,
  )
  const lastPositionRef = useRef<number | undefined>(undefined)
  /** The next stream stays paused: a session reopened (retry) while the video was paused. */
  const startPausedRef = useRef(false)
  /** Audio changed with the subtitles left to the cascade: remembered once that session opens. */
  const pendingAudioMemoryRef = useRef<{ attempt: number } | undefined>(undefined)
  const gestureRef = useRef<{
    pointer: string
    start?: { x: number; y: number; volume: number; height: number; dragging: boolean } | undefined
    lastTap?: Tap | undefined
    tapTimer?: ReturnType<typeof setTimeout> | undefined
    hudTimer?: ReturnType<typeof setTimeout> | undefined
  }>({ pointer: 'mouse' })

  const [video, videoRef] = useElement<HTMLVideoElement>()
  const [container, containerRef] = useElement<HTMLDivElement>()
  const [trackElement, trackRef] = useElement<HTMLTrackElement>()
  const state = useVideoState(video)
  const fullscreen = useIsFullscreen()
  const [pipStage, setPipStage] = useState<HTMLElement>()
  const pip = usePictureInPicture(video) || pipStage !== undefined
  const airPlay = useAirPlayAvailable(video)

  const playback = useQuery({
    queryKey: ['playback', itemId, request],
    queryFn: async ({ signal }) => {
      const started = await createPlaybackSession(itemId, request)
      // Left before the answer: the query dropped it (a remount refetches), so nobody else ends it.
      if (signal.aborted)
        void endSessionOnce(started.session.id, {
          positionMs: started.session.startPositionMs,
          paused: true,
        })
      return started
    },
    gcTime: 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const session: PlaybackSessionDto | undefined = playback.data?.session
  const hlsMode = playback.data?.hls ?? 'mse'
  // §10.4: iOS shows the stream's subtitle renditions itself (PiP, AirPlay), no `<track>`.
  const hlsSubtitles = playback.data?.subtitles === 'hls'

  // ── Timeline ────────────────────────────────────────────────────────────────
  const streamMs = state.duration * 1000
  const totalMs =
    session === undefined
      ? (switching?.totalMs ?? item.data?.durationMs ?? 0)
      : totalDurationMs(session, streamMs)
  const positionMs =
    session === undefined
      ? (switching?.positionMs ?? 0)
      : itemPositionMs(session, state.currentTime)
  const bufferedMs = session === undefined ? 0 : itemPositionMs(session, state.bufferedEnd)
  const chapters =
    session === undefined ? [] : chaptersOnItem(session.chapters, session.partOffsetMs)
  const zones = session === undefined ? [] : segmentZones(session.segments, totalMs)
  const followingPart = session === undefined ? undefined : nextPart(session)
  const trickplayUrl = session?.trickplayUrl
  const trickplay = useQuery({
    queryKey: ['trickplay', trickplayUrl],
    queryFn: () => fetchTrickplayIndex(trickplayUrl ?? ''),
    enabled: trickplayUrl !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  // ── Tracks ──────────────────────────────────────────────────────────────────
  const audioIndex = session?.selectedAudioStreamIndex
  const subtitleId =
    session === undefined
      ? undefined
      : subtitleChoice?.sessionId === session.id
        ? subtitleChoice.id
        : session.selectedSubtitleTrackId
  const vttTrack =
    session === undefined || hlsSubtitles
      ? undefined
      : vttTrackOf(session.subtitleTracks, subtitleId)
  const scope = item.data?.kind === 'episode' ? 'series' : 'movie'

  // The player never stays in the history: quitting goes back to the page it was opened from
  // (else replaces it with the item page), so "Retour" from there never reopens the video.
  const exit = useCallback(() => {
    if (canGoBack) {
      router.history.back()
      return
    }
    const data = item.data
    if (data?.kind === 'episode' && data.series !== undefined) {
      void navigate({
        to: '/items/$itemId',
        params: { itemId: data.series.id },
        search: data.seasonNumber === undefined ? {} : { season: data.seasonNumber },
        replace: true,
      })
    } else {
      void navigate({ to: '/items/$itemId', params: { itemId }, replace: true })
    }
  }, [canGoBack, item.data, itemId, navigate, router])

  // One history entry for a whole binge: the next episode replaces the current one.
  const playEpisode = useCallback(
    (episode: Pick<ItemSummaryDto, 'id'>) =>
      void navigate({
        to: '/watch/$itemId',
        params: { itemId: episode.id },
        search: {},
        replace: true,
      }),
    [navigate],
  )

  // ── Session changes ─────────────────────────────────────────────────────────
  const currentPosition = () =>
    video !== undefined && session !== undefined && video.readyState > 0
      ? itemPositionMs(session, video.currentTime)
      : (lastPositionRef.current ?? positionMs)

  /** New session for `change`: the current one is stopped and deleted first (§10.2). */
  const switchSession = async (change: SessionChange) => {
    if (session === undefined) return
    const at = currentPosition()
    setSwitching({ positionMs: change.type === 'part' ? change.part.offsetMs : at, totalMs })
    setOverlay(undefined)
    const last = teardownRef.current?.() ?? { positionMs: at, paused: false }
    startPausedRef.current = change.type === 'retry' && last.paused === true
    const nextValue = nextRequest({
      request,
      session,
      tracks: { audioStreamIndex: audioIndex, subtitleTrackId: subtitleId, subtitlesChosen },
      change,
      positionMs: at,
    })
    await endSessionOnce(session.id, last)
    setInterruption(undefined)
    setRequest(nextValue)
  }

  const onStreamFailure = useEffectEvent(({ failure, network }: StreamFailure) => {
    if (interruption !== undefined) return
    setInterruption(network ? { kind: 'network', failure } : { kind: 'failure', failure })
  })
  const onPlaying = useEffectEvent(() => {
    if (reconnectAttempt !== 0) setReconnectAttempt(0)
    if (switching !== undefined) setSwitching(undefined)
  })
  const applyRate = useEffectEvent((element: HTMLVideoElement) => setPlaybackRate(element, rate))
  const onStreamEnded = useEffectEvent(() => {
    if (followingPart !== undefined) void switchSession({ type: 'part', part: followingPart })
  })

  /** The stream to attach: the renditions of `master.m3u8` carry the subtitle delay (§10.4). */
  const streamedSession = useEffectEvent((current: PlaybackSessionDto) =>
    hlsSubtitles && current.stream.type === 'hls'
      ? {
          ...current,
          stream: {
            ...current.stream,
            url: withSubtitleOffset(current.stream.url, subtitleSettings.delayMs),
          },
        }
      : current,
  )

  useEffect(() => {
    if (pipStage === undefined || video === undefined) return
    return showInDocumentPictureInPicture(pipStage, video, () => setPipStage(undefined))
  }, [pipStage, video])

  // Stream attachment and session lifecycle.
  useEffect(() => {
    if (video === undefined || session === undefined) return
    retainSession(session.id)
    openingMemoryRef.current ??= { value: memoryAtOpen(session) }
    restoreVolume(video)
    applyRate(video)
    const detach = attachStream(
      video,
      streamedSession(session),
      hlsMode,
      (failure) => onStreamFailure(failure),
      !startPausedRef.current,
    )
    const heartbeat = startHeartbeat({
      sessionId: session.id,
      intervalMs: session.heartbeatIntervalMs,
      // Before the first frame currentTime is 0: report the resume point, not the start.
      read: () => ({
        positionMs:
          video.readyState > 0
            ? itemPositionMs(session, video.currentTime)
            : session.startPositionMs,
        paused: video.paused,
      }),
      transport: playbackTransport,
      timers: {
        setInterval: (callback, ms) => window.setInterval(callback, ms),
        clearInterval: (handle) => window.clearInterval(handle as number),
      },
      onFailure: (failure) => {
        const apiError = toApiFailure(failure)
        if (sessionTimedOut(apiError)) onStreamFailure({ failure: apiError, network: true })
      },
    })
    heartbeatRef.current = heartbeat
    const beat = () => {
      if (video.readyState > 0) heartbeat.beat()
    }
    const ended = () => {
      beat()
      onStreamEnded()
    }
    const close = () => heartbeat.close()
    const remember = () => saveVolume(video.volume, video.muted)
    const track = () => {
      if (video.readyState > 0) lastPositionRef.current = itemPositionMs(session, video.currentTime)
    }
    const playing = () => onPlaying()
    const loaded = () => applyRate(video)
    video.addEventListener('pause', beat)
    video.addEventListener('seeked', beat)
    video.addEventListener('ended', ended)
    video.addEventListener('volumechange', remember)
    video.addEventListener('timeupdate', track)
    video.addEventListener('playing', playing)
    video.addEventListener('loadedmetadata', loaded)
    window.addEventListener('pagehide', close)
    let last: PlaybackHeartbeatBody | undefined
    const teardown = (): PlaybackHeartbeatBody => {
      if (last !== undefined) return last
      last = heartbeat.halt()
      video.removeEventListener('pause', beat)
      video.removeEventListener('seeked', beat)
      video.removeEventListener('ended', ended)
      video.removeEventListener('volumechange', remember)
      video.removeEventListener('timeupdate', track)
      video.removeEventListener('playing', playing)
      video.removeEventListener('loadedmetadata', loaded)
      window.removeEventListener('pagehide', close)
      detach()
      return last
    }
    teardownRef.current = teardown
    return () => {
      const position = teardown()
      if (teardownRef.current === teardown) teardownRef.current = undefined
      if (heartbeatRef.current === heartbeat) heartbeatRef.current = undefined
      releaseSession(session.id, () => {
        const ending = endSessionOnce(session.id, position)
        // Progress, "Reprendre" and "vu" changed: the pages behind the player refetch them.
        void ending.then(() => queryClient.invalidateQueries({ queryKey: ['catalog'] }))
        return ending
      })
    }
  }, [video, session, hlsMode, queryClient])

  useServerEvent('playback.session_terminated', (payload) => {
    if (session === undefined || payload.playbackSessionId !== session.id) return
    // The echo of our own DELETE during a switch (the next session is not on screen yet): not an
    // interruption, or the new session plays under a "session expired" screen.
    if (isSessionLetGo(session.id)) return
    forgetSession(session.id)
    teardownRef.current?.()
    setInterruption(
      sessionTimedOut(payload)
        ? {
            kind: 'network',
            failure: apiFailure(410, 'playback/session_expired', 'playback session ended'),
          }
        : { kind: 'terminated', reason: payload.reason },
    )
  })

  // §10.4: Safari lists the stream's subtitle renditions as text tracks; the chosen one shows.
  useEffect(() => {
    if (video === undefined || session === undefined || !hlsSubtitles) return
    const label = renditionLabel(session.subtitleTracks, subtitleId)
    const apply = () => {
      for (const track of Array.from(video.textTracks)) {
        if (track.kind !== 'subtitles' && track.kind !== 'captions') continue
        track.mode = label !== undefined && track.label === label ? 'showing' : 'disabled'
      }
    }
    apply()
    video.textTracks.addEventListener('addtrack', apply)
    return () => video.textTracks.removeEventListener('addtrack', apply)
  }, [video, session, subtitleId, hlsSubtitles])

  // §10.4: a new delay reloads the same session's master at the current time, once it settles.
  useEffect(() => {
    if (video === undefined || session?.stream.type !== 'hls' || !hlsSubtitles) return
    const url = withSubtitleOffset(session.stream.url, subtitleSettings.delayMs)
    if (video.src.endsWith(url)) return
    const timer = setTimeout(() => reloadStream(video, url), 800)
    return () => clearTimeout(timer)
  }, [video, session, hlsSubtitles, subtitleSettings.delayMs])

  // iOS plays fullscreen in its own player: the browser draws the subtitles there.
  useEffect(() => {
    if (video === undefined) return
    const begin = () => setNativeFullscreen(true)
    const end = () => setNativeFullscreen(false)
    video.addEventListener('webkitbeginfullscreen', begin)
    video.addEventListener('webkitendfullscreen', end)
    return () => {
      video.removeEventListener('webkitbeginfullscreen', begin)
      video.removeEventListener('webkitendfullscreen', end)
    }
  }, [video])

  const reconnect = useEffectEvent(() => {
    setReconnectAttempt((value) => value + 1)
    if (session !== undefined) {
      void switchSession({ type: 'retry' })
      return
    }
    setInterruption(undefined)
    setRequest((value) => retriedRequest(value, lastPositionRef.current))
  })

  const restart = () => {
    setReconnectAttempt(0)
    if (session !== undefined && interruption?.kind !== 'terminated') {
      void switchSession({ type: 'retry' })
      return
    }
    setInterruption(undefined)
    setRequest((value) => retriedRequest(value, lastPositionRef.current))
  }

  const failure =
    interruption?.kind === 'failure' || interruption?.kind === 'network'
      ? interruption.failure
      : playback.isError
        ? playback.error
        : undefined
  const networkLost =
    failure !== undefined &&
    (interruption?.kind === 'network' || failure.code === 'network') &&
    reconnectDelay(reconnectAttempt) !== undefined

  // Network loss or timed-out session: a new session at the position, after a growing delay or
  // as soon as the connection or the page (unlocked phone, tab shown again) comes back.
  useEffect(() => {
    if (!networkLost) return
    const timer = setTimeout(() => reconnect(), reconnectDelay(reconnectAttempt))
    const online = () => reconnect()
    const visible = () => {
      if (document.visibilityState === 'visible') reconnect()
    }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [networkLost, reconnectAttempt])

  // ── Track changes ───────────────────────────────────────────────────────────
  const remember = (kind: TrackKind, selection: Parameters<typeof preferencesOf>[0]) => {
    const current = preferencesOf(selection)
    const previous = memory?.value ?? openingMemoryRef.current?.value
    const nextToast = toastForChange({
      previousToast: toast,
      memory: previous,
      kind,
      scope,
      current,
    })
    setSkipped(undefined)
    setToast(nextToast)
    setMemory({ value: current })
    writeMemory(() => putTrackPreferences(itemId, current)).catch(() =>
      setToast((shown) => (shown?.id === nextToast.id ? { ...shown, status: 'failed' } : shown)),
    )
  }

  /**
   * Subtitles chosen in this playback: kept, remembered with the new audio right away. Otherwise
   * the cascade picks them for the new audio (§11.2) and the memory is written once the new
   * session shows what it picked (written before, the cascade would read it back).
   */
  const chooseAudio = (track: AudioTrackDto) => {
    if (session === undefined || track.index === audioIndex) return
    if (subtitlesChosen) {
      remember('audio', {
        audio: track,
        subtitle: session.subtitleTracks.find((candidate) => candidate.id === subtitleId),
      })
    } else {
      pendingAudioMemoryRef.current = { attempt: request.attempt + 1 }
    }
    void switchSession({ type: 'audio', index: track.index })
  }

  const rememberCascadeAudio = useEffectEvent((opened: PlaybackSessionDto) => {
    const pending = pendingAudioMemoryRef.current
    pendingAudioMemoryRef.current = undefined
    if (pending?.attempt === request.attempt) remember('audio', selectionOf(opened))
  })

  useEffect(() => {
    if (session !== undefined) rememberCascadeAudio(session)
  }, [session])

  const chooseSubtitle = (choice: SubtitleChoice) => {
    if (session === undefined) return
    const id = choice.kind === 'off' ? undefined : choice.track.id
    if (id === subtitleId) return
    if (subtitleId !== undefined) setLastSubtitleId(subtitleId)
    setSubtitlesChosen(true)
    remember('subtitles', {
      audio: session.audioTracks.find((track) => track.index === audioIndex),
      subtitle: choice.kind === 'off' ? undefined : choice.track,
    })
    if (needsNewSession(session, choice, playback.data?.subtitles)) {
      void switchSession({ type: 'subtitles', trackId: id ?? 'off' })
      return
    }
    setSubtitleChoice({ sessionId: session.id, id })
    heartbeatRef.current?.beat()
  }

  const setProfileDefault = () => {
    if (toast === undefined || profile === undefined) return
    const body = profileDefaultsFor(toast.kind, toast.current, profile)
    if (body === undefined) return
    const id = toast.id
    setToast({ ...toast, status: 'defaulting' })
    updateProfile.mutate(
      { id: profile.id, body },
      {
        onSuccess: () =>
          setToast((shown) => (shown?.id === id ? { ...shown, status: 'defaulted' } : shown)),
        onError: () =>
          setToast((shown) => (shown?.id === id ? { ...shown, status: 'failed' } : shown)),
      },
    )
  }

  const undoMemory = () => {
    if (toast === undefined) return
    const action = undoActionFor(toast.previous)
    const id = toast.id
    setMemory({ value: toast.previous })
    setToast({ ...toast, status: 'undone' })
    const done = writeMemory(() =>
      action.type === 'delete'
        ? deleteTrackPreferences(itemId)
        : putTrackPreferences(itemId, action.body),
    )
    done.catch(() =>
      setToast((shown) => (shown?.id === id ? { ...shown, status: 'failed' } : shown)),
    )
  }

  useEffect(() => {
    if (toast === undefined) return
    const delay = toastHideDelay(toast)
    if (delay === undefined) return
    const timer = setTimeout(() => setToast(undefined), delay)
    return () => clearTimeout(timer)
  }, [toast])

  const changeSubtitleSettings = (update: (settings: SubtitleSettings) => SubtitleSettings) =>
    setSubtitleSettings(update)

  // Delay and size are remembered per device (§10.4).
  useEffect(() => saveSubtitleSettings(subtitleSettings), [subtitleSettings])

  const changeRate = (value: number) => {
    setRate(value)
    if (video !== undefined) setPlaybackRate(video, value)
  }

  // ── End of the item ─────────────────────────────────────────────────────────
  const itemEnded = state.ended && followingPart === undefined && session !== undefined
  const nextEpisode = next.status === 'found' ? next.episode : undefined

  // Without a next episode: back to the page after 5 s (§10.7).
  useEffect(() => {
    if (!itemEnded || next.status !== 'none') return
    const timer = setTimeout(exit, endedReturnDelayMs)
    return () => clearTimeout(timer)
  }, [itemEnded, next.status, exit])

  // ── Chrome ──────────────────────────────────────────────────────────────────
  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), idleDelayMs)
  }, [])

  useEffect(() => {
    idleTimer.current = setTimeout(() => setIdle(true), idleDelayMs)
    return () => clearTimeout(idleTimer.current)
  }, [])

  const closeOverlay = () => {
    // The button that opened a menu gets the focus back.
    const opener =
      overlay === undefined
        ? undefined
        : container?.querySelector<HTMLButtonElement>(`[data-menu="${overlay}"]`)
    setOverlay(undefined)
    opener?.focus()
  }

  // ── Commands ────────────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (video !== undefined) togglePlayback(video)
  }

  const seekToItem = (target: number) => {
    if (video === undefined || session === undefined) return
    const where = seekTargetFor(session, streamMs, target)
    if (where.kind === 'stream') seekTo(video, where.seconds)
    else void switchSession({ type: 'seek_part', part: where.part, positionMs: where.positionMs })
  }

  const seekBy = (deltaMs: number) => seekToItem(currentPosition() + deltaMs)

  const setVolume = (volume: number) => {
    if (video !== undefined) setVolumeLevel(video, volume)
  }

  const toggleMute = () => {
    if (video !== undefined) toggleMuted(video)
  }

  const toggleFull = () => {
    if (container !== undefined && video !== undefined) toggleFullscreen(container, video)
  }

  /** Over an intro or a recap: to its end, "Intro skipped · Undo" (§12.4). */
  const skipOver = (segment: SkippableSegment) => {
    handledSegmentsRef.current.add(segmentKey(segment))
    setToast(undefined)
    setSkipped((shown) => ({ segment, id: (shown?.id ?? 0) + 1 }))
    seekToItem(segment.endMs)
  }

  /** "Undo": back to the start of the segment, which is not skipped automatically again. */
  const undoSkip = () => {
    if (skipped === undefined) return
    const { segment } = skipped
    setSkipped(undefined)
    setSkipEntry({ key: segmentKey(segment), atMs: segment.startMs })
    seekToItem(segment.startMs)
  }

  /** `S`: over the intro or recap playing, else to the end of the segment playing (credits…). */
  const skipSegment = () => {
    if (session === undefined) return
    const at = currentPosition()
    const skippable = skippableAt(session.segments, at)
    if (skippable !== undefined) {
      skipOver(skippable)
      return
    }
    const segment = segmentAt(session.segments, at)
    if (segment !== undefined) seekToItem(segment.endMs)
  }

  const toggleSubtitles = () => {
    if (session === undefined) return
    const choice = toggledSubtitle({
      tracks: session.subtitleTracks,
      selectedId: subtitleId,
      lastId: lastSubtitleId,
      preferredLanguage: profile?.subtitleLanguage,
    })
    if (choice !== undefined) chooseSubtitle(choice)
  }

  // ── Segments (§12.4): "Skip intro", "Next episode" ──────────────────
  const blocked = (failure !== undefined && !networkLost) || interruption?.kind === 'terminated'
  const segments = session?.segments ?? []
  const skippable = session === undefined ? undefined : skippableAt(segments, positionMs)
  const skippableKey = skippable === undefined ? undefined : segmentKey(skippable)
  const skipView =
    skippable !== undefined && skipEntry !== undefined && skipEntry.key === skippableKey
      ? skipButtonPhase(skipEntry.atMs, positionMs)
      : { phase: 'full' as const, progress: 0 }

  // Read from `<video>` on each `timeupdate` (never at 0 before the stream reached its start
  // position): where the button appeared, and `autoSkipIntro`, once per segment while it plays.
  const onSegmentTime = useEffectEvent((element: HTMLVideoElement) => {
    if (session === undefined || blocked || element.readyState === 0) return
    const at = itemPositionMs(session, element.currentTime)
    const playing = skippableAt(session.segments, at)
    const key = playing === undefined ? undefined : segmentKey(playing)
    setSkipEntry((entry) =>
      key === undefined ? undefined : entry?.key === key ? entry : { key, atMs: at },
    )
    if (element.paused || element.seeking) return
    const target = autoSkipTarget({
      segments: session.segments,
      positionMs: at,
      autoSkipIntro: profile?.autoSkipIntro ?? false,
      handled: handledSegmentsRef.current,
    })
    if (target !== undefined) skipOver(target)
  })
  useEffect(() => {
    if (video === undefined) return
    const listener = () => onSegmentTime(video)
    video.addEventListener('timeupdate', listener)
    return () => video.removeEventListener('timeupdate', listener)
  }, [video])

  useEffect(() => {
    if (skipped === undefined) return
    const timer = setTimeout(() => setSkipped(undefined), toastAutoHideMs)
    return () => clearTimeout(timer)
  }, [skipped])

  const trigger =
    session === undefined
      ? undefined
      : nextUpTriggerAt({ segments, positionMs, totalMs, ended: itemEnded })
  const nextUpShown =
    !blocked && nextUpVisible({ trigger, dismissed: dismissedNextUp, next: next.status })
  const countdownStart =
    nextEpisode === undefined
      ? undefined
      : countdownStartMs({
          autoplayNext: profile?.autoplayNext ?? true,
          autoSkipCredits: profile?.autoSkipCredits ?? false,
        })
  const activeCountdown =
    nextUpShown && trigger !== undefined
      ? countdownFor(countdown, trigger, countdownStart)
      : undefined
  const counting =
    activeCountdown?.leftMs !== undefined &&
    activeCountdown.leftMs > 0 &&
    (itemEnded || !state.paused)
  const launch = activeCountdown?.leftMs === 0 && nextEpisode !== undefined

  // Closing the card drops its countdown: back into the credits, it starts over.
  useEffect(() => {
    if (!nextUpShown) return
    return () => setCountdown(undefined)
  }, [nextUpShown])

  const tick = useEffectEvent((elapsedMs: number) => {
    if (trigger === undefined) return
    setCountdown((previous) => ticked(countdownFor(previous, trigger, countdownStart), elapsedMs))
  })
  useEffect(() => {
    if (!counting) return
    let last = performance.now()
    const timer = setInterval(() => {
      const now = performance.now()
      tick(now - last)
      last = now
    }, countdownTickMs)
    return () => clearInterval(timer)
  }, [counting])

  const playNext = useEffectEvent(() => {
    if (nextEpisode !== undefined) playEpisode(nextEpisode)
  })
  useEffect(() => {
    if (launch) playNext()
  }, [launch])

  // Now Playing: lock screen, Control Center, headset keys (§10.7).
  const posterUrl = item.data?.series?.images?.poster ?? item.data?.images.poster
  const nowPlaying = useMemo(
    () => (title === '' ? undefined : nowPlayingOf({ title, subtitle, posterUrl })),
    [title, subtitle, posterUrl],
  )
  useMediaSession({
    video,
    metadata: nowPlaying,
    seekBy,
    next: nextEpisode === undefined ? undefined : () => playEpisode(nextEpisode),
  })

  // "Vu" on entering the credits (§13.1): the server hears of the position right away.
  const creditsKey = trigger?.kind === 'credits' ? trigger.key : undefined
  useEffect(() => {
    if (creditsKey !== undefined) heartbeatRef.current?.beat()
  }, [creditsKey])

  const nextDetail = useQuery({
    ...itemQuery(nextEpisode?.id ?? ''),
    enabled: nextEpisode !== undefined,
  })

  const watchCredits = () => {
    if (trigger !== undefined) setDismissedNextUp((keys) => new Set(keys).add(trigger.key))
    wake()
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const command = commandFor(event, {
      editing: isEditable(event.target ?? undefined),
      inOverlay: inOverlay(event.target ?? undefined),
      overlayOpen: overlay !== undefined,
      fullscreen,
    })
    wake()
    if (command === undefined) return
    if (command !== 'exit' && command !== 'close_overlay') event.preventDefault()
    switch (command) {
      case 'toggle_play':
        return togglePlay()
      case 'seek_back':
        return seekBy(-seekStepMs)
      case 'seek_forward':
        return seekBy(seekStepMs)
      case 'volume_up':
        return setVolume((video?.volume ?? 1) + volumeStep)
      case 'volume_down':
        return setVolume((video?.volume ?? 1) - volumeStep)
      case 'toggle_mute':
        return toggleMute()
      case 'toggle_fullscreen':
        return toggleFull()
      case 'skip_segment':
        return skipSegment()
      case 'next_episode':
        if (nextEpisode !== undefined) playEpisode(nextEpisode)
        return
      case 'toggle_subtitles':
        return toggleSubtitles()
      case 'close_overlay':
        return closeOverlay()
      case 'exit':
        return exit()
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  // ── Touch: double tap ±10 s on the sides, vertical drag for the volume ──────
  const showSeekHud = (side: 'left' | 'right') => {
    const gesture = gestureRef.current
    clearTimeout(gesture.hudTimer)
    setSeekHud((shown) => ({
      side,
      seconds: shown?.side === side ? shown.seconds + 10 : 10,
      id: (shown?.id ?? 0) + 1,
    }))
    gesture.hudTimer = setTimeout(() => setSeekHud(undefined), hudDelayMs)
  }

  const onSurfacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    gesture.pointer = event.pointerType
    if (event.pointerType === 'mouse') return
    const rect = event.currentTarget.getBoundingClientRect()
    gesture.start = {
      x: event.clientX,
      y: event.clientY,
      volume: video?.volume ?? 1,
      height: rect.height,
      dragging: false,
    }
  }

  const onSurfacePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gestureRef.current.start
    if (start === undefined || video === undefined) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.dragging && isVerticalDrag(dx, dy) && volumeSettable(video)) start.dragging = true
    if (!start.dragging) return
    const volume = volumeAfterDrag(start.volume, dy, start.height)
    setVolume(volume)
    setVolumeHud(volume)
  }

  const onSurfacePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    const start = gesture.start
    gesture.start = undefined
    if (event.pointerType === 'mouse' || start === undefined) return
    if (start.dragging) {
      setVolumeHud(undefined)
      return
    }
    if (overlay !== undefined) {
      closeOverlay()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const tap: Tap = { time: event.timeStamp, x: event.clientX, y: event.clientY }
    const zone = tapZone(event.clientX - rect.left, rect.width)
    if (zone !== 'center' && isDoubleTap(gesture.lastTap, tap)) {
      clearTimeout(gesture.tapTimer)
      gesture.lastTap = tap
      seekBy(zone === 'left' ? -seekStepMs : seekStepMs)
      showSeekHud(zone)
      return
    }
    gesture.lastTap = tap
    clearTimeout(gesture.tapTimer)
    gesture.tapTimer = setTimeout(() => {
      gesture.lastTap = undefined
      if (idle) wake()
      else setIdle(true)
    }, 260)
  }

  const onSurfaceClick = () => {
    if (gestureRef.current.pointer !== 'mouse') return
    if (overlay !== undefined) closeOverlay()
    else togglePlay()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const loading =
    !blocked &&
    (networkLost ||
      playback.isPending ||
      (switching !== undefined && session === undefined) ||
      (state.waiting && !state.paused) ||
      !state.ready)
  const showEnd = itemEnded && !blocked && !nextUpShown
  const chromeVisible =
    !idle || state.paused || blocked || overlay !== undefined || showEnd || nextUpShown
  const canAct = session !== undefined && !blocked
  const muted = state.muted || state.volume === 0
  const thumbnailFor = (ms: number) => {
    if (session === undefined || trickplay.data === undefined || trickplayUrl === undefined)
      return undefined
    const start = session.partOffsetMs
    const end = start + currentPartDurationMs(session, streamMs)
    if (ms < start || ms >= end) return undefined
    return thumbnailAt(trickplay.data, trickplayUrl, (ms - start) / 1000, streamMs / 1000)
  }
  const toastCanDefault =
    toast !== undefined &&
    profile !== undefined &&
    profileDefaultsFor(toast.kind, toast.current, profile) !== undefined
  const limitReached = failure?.code === 'playback/transcode_limit_reached'

  const menuTitles: Record<PlayerMenu, string> = {
    languages: t('player.menu.title'),
    speed: t('player.menu.speed'),
    quality: t('player.menu.quality'),
    chapters: t('player.menu.chapters'),
  }
  const menuButton = (menu: PlayerMenu, icon: ReactNode) => (
    <button
      data-menu={menu}
      type="button"
      className="player__control"
      aria-label={menuTitles[menu]}
      aria-expanded={overlay === menu}
      aria-haspopup="dialog"
      disabled={session === undefined}
      onClick={() => setOverlay((open) => (open === menu ? undefined : menu))}
    >
      {icon}
    </button>
  )

  return (
    <div
      ref={containerRef}
      className={`player${chromeVisible ? '' : ' player--idle'}${nextUpShown ? ' player--next-up' : ''}${overlay === 'languages' ? ' player--menu' : ''}`}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') wake()
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') wake()
      }}
    >
      <video
        ref={videoRef}
        className={`player__video${hlsSubtitles ? ' player__video--native-cues' : ''}`}
        playsInline
        preload="auto"
      >
        {vttTrack === undefined || vttTrack.url === undefined ? undefined : (
          <track
            key={`${session?.id ?? ''}-${vttTrack.id}`}
            ref={trackRef}
            kind="subtitles"
            src={vttTrack.url}
            {...(vttTrack.language === undefined ? {} : { srcLang: vttTrack.language })}
            label={vttTrack.title ?? vttTrack.language ?? ''}
          />
        )}
      </video>

      {pipStage === undefined ? (
        <SubtitleOverlay
          key={vttTrack === undefined ? 'off' : `${session?.id ?? ''}-${vttTrack.id}`}
          element={vttTrack === undefined ? undefined : trackElement}
          delayMs={subtitleSettings.delayMs}
          size={subtitleSettings.size}
          raised={chromeVisible}
          aboveToast={(toast !== undefined || skipped !== undefined) && !blocked}
          native={nativeFullscreen || (pip && pictureInPictureShowsTextTracks(video))}
        />
      ) : (
        createPortal(
          <SubtitleOverlay
            key={vttTrack === undefined ? 'off' : `${session?.id ?? ''}-${vttTrack.id}`}
            element={vttTrack === undefined ? undefined : trackElement}
            delayMs={subtitleSettings.delayMs}
            size={subtitleSettings.size}
            raised={false}
            aboveToast={false}
            native={false}
          />,
          pipStage,
        )
      )}

      <div
        className="player__surface"
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onSurfacePointerMove}
        onPointerUp={onSurfacePointerUp}
        onPointerCancel={() => {
          gestureRef.current.start = undefined
          setVolumeHud(undefined)
        }}
        onClick={onSurfaceClick}
        onDoubleClick={() => {
          if (gestureRef.current.pointer === 'mouse') toggleFull()
        }}
        aria-hidden="true"
      />

      {seekHud === undefined ? undefined : (
        <div
          key={seekHud.id}
          className={`player__seek-hud player__seek-hud--${seekHud.side}`}
          aria-hidden="true"
        >
          {seekHud.side === 'left' ? <Rewind10Icon size={26} /> : <Forward10Icon size={26} />}
          <span>{seekHud.side === 'left' ? `−${seekHud.seconds} s` : `+${seekHud.seconds} s`}</span>
        </div>
      )}

      {volumeHud === undefined ? undefined : (
        <div className="player__volume-hud" aria-hidden="true">
          <progress className="player__volume-hud-bar" value={volumeHud} max={1} />
          {volumeHud === 0 ? <MutedIcon size={20} /> : <VolumeIcon size={20} />}
        </div>
      )}

      {loading ? (
        <div className="player__center" role="status">
          <span className="spinner spinner--large" aria-hidden="true" />
          {networkLost ? (
            <span className="player__center-text">{t('player.reconnecting')}</span>
          ) : (
            <span className="visually-hidden">{t('common.loading')}</span>
          )}
        </div>
      ) : undefined}

      {!loading && !blocked && !showEnd && !nextUpShown && overlay === undefined && state.paused ? (
        <button
          type="button"
          className="player__big-play"
          aria-label={t('player.play')}
          onClick={togglePlay}
        >
          <PlayIcon size={34} />
        </button>
      ) : undefined}

      {canAct && !showEnd && !nextUpShown ? (
        <div className="player__touch" aria-hidden={!chromeVisible}>
          <button
            type="button"
            className="player__touch-button"
            aria-label={t('player.back10')}
            tabIndex={-1}
            onClick={() => seekBy(-seekStepMs)}
          >
            <Rewind10Icon size={30} />
          </button>
          <button
            type="button"
            className="player__touch-button player__touch-button--main"
            aria-label={state.paused ? t('player.play') : t('player.pause')}
            tabIndex={-1}
            onClick={togglePlay}
          >
            {state.paused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
          </button>
          <button
            type="button"
            className="player__touch-button"
            aria-label={t('player.forward10')}
            tabIndex={-1}
            onClick={() => seekBy(seekStepMs)}
          >
            <Forward10Icon size={30} />
          </button>
        </div>
      ) : undefined}

      <div className="player__top">
        <button
          type="button"
          className="player__control"
          aria-label={t('player.quit')}
          onClick={exit}
        >
          <BackIcon size={22} />
        </button>
        {session?.burnIn === true ? (
          <span className="player__badge">{t('player.burnIn')}</span>
        ) : undefined}
      </div>

      {canAct && skippable !== undefined && !nextUpShown ? (
        <SkipSegmentButton
          key={skippableKey}
          segment={skippable}
          phase={skipView.phase}
          progress={skipView.progress}
          onSkip={() => skipOver(skippable)}
        />
      ) : undefined}

      {skipped === undefined || blocked ? undefined : (
        <SkippedToast key={skipped.id} segment={skipped.segment} onUndo={undoSkip} />
      )}

      {toast === undefined || blocked ? undefined : (
        <TrackToast
          toast={toast}
          canSetDefault={toastCanDefault}
          onSetDefault={setProfileDefault}
          onUndo={undoMemory}
        />
      )}

      {blocked ? (
        <div className="player__overlay" role="alert">
          <p className="player__overlay-title">
            {interruption?.kind === 'terminated'
              ? interruption.reason === 'admin'
                ? t('player.terminatedByAdmin')
                : t('player.sessionEnded')
              : limitReached
                ? t('errors.playback/transcode_limit_reached')
                : t('player.errorTitle')}
          </p>
          {failure === undefined || limitReached ? undefined : (
            <p className="player__overlay-text">{errorMessage(failure)}</p>
          )}
          <div className="player__overlay-actions">
            <button type="button" className="button button--glass" onClick={exit}>
              {t('player.back')}
            </button>
            <button type="button" className="button button--primary" onClick={restart}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      ) : undefined}

      {nextUpShown ? (
        <>
          <NextUpCard
            next={nextEpisode}
            detail={nextDetail.data}
            fallbackArt={item.data?.series?.images?.backdrop ?? item.data?.images.backdrop}
            countdown={
              activeCountdown === undefined || activeCountdown.leftMs === undefined
                ? undefined
                : {
                    seconds: secondsLeft(activeCountdown) ?? 0,
                    ratio: countdownRatio(activeCountdown, countdownStart),
                  }
            }
            ended={itemEnded}
            onPlay={() => {
              if (nextEpisode !== undefined) playEpisode(nextEpisode)
            }}
            onWatchCredits={watchCredits}
            onBack={exit}
          />
          <div className="next-up__progress" aria-hidden="true">
            <span
              className="next-up__progress-fill"
              style={{ width: `${ratioOf(positionMs, totalMs) * 100}%` }}
            />
          </div>
        </>
      ) : undefined}

      {showEnd ? (
        // Only without a next episode: with one, the card above is the end screen.
        <div className="player__overlay player__overlay--end" role="status">
          <p className="player__overlay-title">{t('player.ended')}</p>
          <p className="player__overlay-text">{t('player.returning')}</p>
          <div className="player__overlay-actions">
            <button type="button" className="button button--primary" onClick={exit}>
              {t('player.backToPage')}
            </button>
          </div>
        </div>
      ) : undefined}

      {overlay !== undefined && overlay !== 'episodes' && session !== undefined ? (
        <div
          className={`player-menu player-menu--${overlay}`}
          data-player-overlay
          role="dialog"
          aria-label={menuTitles[overlay]}
        >
          {overlay === 'languages' ? (
            <LanguagesMenu
              session={session}
              audioIndex={audioIndex}
              subtitleId={subtitleId}
              tab={languagesTab}
              onTab={setLanguagesTab}
              onClose={closeOverlay}
              onAudio={chooseAudio}
              onSubtitle={chooseSubtitle}
              subtitleSettings={subtitleSettings}
              onSubtitleSettings={changeSubtitleSettings}
              sizeAdjustable={!hlsSubtitles}
            />
          ) : overlay === 'speed' ? (
            <SpeedMenu rate={rate} onRate={changeRate} onClose={closeOverlay} />
          ) : overlay === 'quality' ? (
            <QualityMenu
              session={session}
              onQuality={(quality: PlaybackQuality) => {
                if (quality !== session.quality) void switchSession({ type: 'quality', quality })
              }}
              onVersion={(sourceId) => void switchSession({ type: 'version', sourceId })}
              onClose={closeOverlay}
            />
          ) : (
            <ChaptersMenu
              chapters={chapters}
              chapterIndex={chapterIndexAt(chapters, positionMs)}
              onChapter={(startMs) => seekToItem(startMs)}
              onClose={closeOverlay}
            />
          )}
        </div>
      ) : undefined}

      {overlay === 'episodes' && item.data?.kind === 'episode' && item.data.series !== undefined ? (
        <div
          className="episodes-panel"
          data-player-overlay
          role="dialog"
          aria-label={t('player.episodes')}
        >
          <EpisodesPanel
            seriesId={item.data.series.id}
            seasonId={item.data.season?.id ?? item.data.parentId}
            currentId={item.data.id}
            fallbackArt={item.data.series.images?.backdrop}
            onPlay={playEpisode}
            onClose={closeOverlay}
          />
        </div>
      ) : undefined}

      <div className="player__bottom" inert={nextUpShown}>
        <div className="player__bar">
          <Timeline
            positionMs={positionMs}
            bufferedMs={bufferedMs}
            totalMs={totalMs}
            zones={zones}
            chapters={chapters}
            disabled={!canAct || totalMs <= 0}
            label={t('player.seek')}
            valueText={t('player.timeOf', {
              current: formatClock(positionMs),
              total: formatClock(totalMs),
            })}
            thumbnailAt={thumbnailFor}
            onSeek={seekToItem}
            onHoverStart={() => {
              if (trickplay.data !== undefined && trickplayUrl !== undefined)
                preloadImages(sheetUrls(trickplayUrl, trickplay.data))
            }}
          />
          <span
            className="player__remaining"
            aria-label={t('player.remaining', {
              time: formatClock(remainingMs(positionMs, totalMs)),
            })}
          >
            −{formatClock(remainingMs(positionMs, totalMs))}
          </span>
        </div>

        <div className="player__controls">
          <button
            type="button"
            className="player__control player__control--play player__control--pointer"
            aria-label={state.paused ? t('player.play') : t('player.pause')}
            disabled={!canAct}
            onClick={togglePlay}
          >
            {state.paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
          </button>
          <button
            type="button"
            className="player__control player__control--pointer"
            aria-label={t('player.back10')}
            disabled={!canAct}
            onClick={() => seekBy(-seekStepMs)}
          >
            <Rewind10Icon size={24} />
          </button>
          <button
            type="button"
            className="player__control player__control--pointer"
            aria-label={t('player.forward10')}
            disabled={!canAct}
            onClick={() => seekBy(seekStepMs)}
          >
            <Forward10Icon size={24} />
          </button>
          <div className="volume">
            <button
              type="button"
              className="player__control"
              aria-label={state.muted ? t('player.unmute') : t('player.mute')}
              onClick={toggleMute}
            >
              {muted ? <MutedIcon size={22} /> : <VolumeIcon size={22} />}
            </button>
            <div className="volume__slider">
              <progress
                className="volume__level"
                value={muted ? 0 : state.volume}
                max={1}
                aria-hidden="true"
              />
              <input
                className="volume__input"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : state.volume}
                aria-label={t('player.volume')}
                aria-valuetext={`${Math.round((muted ? 0 : state.volume) * 100)} %`}
                onChange={(event) => setVolume(event.target.valueAsNumber)}
              />
            </div>
          </div>

          <div className="player__heading">
            <span className="player__title">{title}</span>
            {subtitle === undefined ? undefined : (
              <span className="player__subtitle">{subtitle}</span>
            )}
          </div>

          {nextEpisode === undefined ? undefined : (
            <button
              type="button"
              className="player__control"
              aria-label={t('player.nextEpisode')}
              onClick={() => playEpisode(nextEpisode)}
            >
              <NextEpisodeIcon size={22} />
            </button>
          )}
          {item.data?.kind === 'episode' && item.data.series !== undefined ? (
            <button
              type="button"
              className="player__control"
              aria-label={t('player.episodes')}
              aria-expanded={overlay === 'episodes'}
              onClick={() => setOverlay((open) => (open === 'episodes' ? undefined : 'episodes'))}
            >
              <EpisodesIcon size={22} />
            </button>
          ) : undefined}
          {chapters.length > 0 ? menuButton('chapters', <ChaptersIcon size={22} />) : undefined}
          {menuButton('speed', <SpeedIcon size={22} />)}
          {session !== undefined && hasQualityChoice(session)
            ? menuButton('quality', <QualityIcon size={22} />)
            : undefined}
          {menuButton('languages', <SubtitlesIcon size={22} />)}
          {pictureInPictureSupported(video) ? (
            <button
              type="button"
              className="player__control player__control--pip"
              aria-label={t('player.menu.pip')}
              aria-pressed={pip}
              onClick={() => {
                if (video === undefined) return
                if (pipStage !== undefined) setPipStage(undefined)
                else if (documentPictureInPictureSupported())
                  void openDocumentPictureInPicture(video).then(setPipStage)
                else togglePictureInPicture(video)
              }}
            >
              <PictureInPictureIcon size={21} />
            </button>
          ) : undefined}
          {airPlay && video !== undefined ? (
            <button
              type="button"
              className="player__control"
              aria-label={t('player.menu.airplay')}
              onClick={() => showAirPlayPicker(video)}
            >
              <AirPlayIcon size={21} />
            </button>
          ) : undefined}
          <button
            type="button"
            className="player__control"
            aria-label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
            onClick={toggleFull}
          >
            {fullscreen ? <CornersInIcon size={20} /> : <CornersIcon size={20} />}
          </button>
        </div>
      </div>
    </div>
  )
}
