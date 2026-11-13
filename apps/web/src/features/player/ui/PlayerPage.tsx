import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import {
  type PointerEvent,
  type ReactNode,
  type RefCallback,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { reducedMotion } from '@projo/design/media'
import { episodeLine, itemTitle } from '@projo/i18n/item-titles'
import { createPlayerController } from '@projo/player/application/player-controller'
import { type PlayerContext, playerView } from '@projo/player/application/player-view'
import { countdownRatio, secondsLeft } from '@projo/player/core/next-up'
import { segmentKey } from '@projo/player/core/segment-skip'
import { vttTrackOf } from '@projo/player/core/subtitles'
import {
  chapterIndexAt,
  chaptersOnItem,
  currentPartDurationMs,
  ratioOf,
  remainingMs,
  segmentZones,
  snapToSeekPoint,
} from '@projo/player/core/timeline'
import { profileDefaultsFor } from '@projo/player/core/track-memory'
import { sheetUrls, thumbnailAt } from '@projo/player/core/trickplay'
import type { ItemDetailDto, ItemSummaryDto } from '@projo/shared/api/catalog'
import type { PlaybackQuality } from '@projo/shared/api/playback'

import { useServerEvent } from '../../../shared/events/events.ts'
import { formatClock } from '../../../shared/format/format.ts'
import { useErrorMessage } from '../../../shared/i18n/errors.ts'
import { pickActiveProfile } from '../../../shared/session/active-profile.ts'
import { sessionQuery } from '../../../shared/session/session.ts'
import {
  BackIcon,
  Forward10Icon,
  MutedIcon,
  PauseIcon,
  PlayIcon,
  Rewind10Icon,
  VolumeIcon,
} from '../../../shared/ui/icons.tsx'
import { useElement } from '../../../shared/ui/use-element.ts'
import { itemQuery } from '../../catalog/queries.ts'
import { useUpdateProfile } from '../../profiles/queries.ts'
import { toggleFullscreen, useIsFullscreen, usePlayerFullscreenScope } from '../fullscreen.ts'
import {
  browserClock,
  browserPage,
  browserStorage,
  browserTimers,
  fetchTrickplayIndex,
  playbackApi,
  preloadImages,
  sessionEnds,
} from '../playback-api.ts'
import type { WebPlayerEngine } from '../web-engine.ts'
import { EpisodesPanel } from './EpisodesPanel.tsx'
import { nowPlayingOf } from './media-session.ts'
import { NextUpBubble, NextUpCard, type NextUpCountdownView } from './NextUpCard.tsx'
import {
  AirPlayIcon,
  ChaptersIcon,
  CornersIcon,
  CornersInIcon,
  EpisodesIcon,
  NextEpisodeIcon,
  PictureInPictureIcon,
  QualityIcon,
  SeekArrowsIcon,
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
  type Pinch,
  type PinchPoint,
  pinchCloses,
  pinchMoved,
  pinchStarted,
} from './pinch-gesture.ts'
import { commandFor, isVerticalDrag, tapZone, volumeAfterDrag } from './shortcuts.ts'
import { SkippedToast, SkipSegmentButton } from './SkipSegment.tsx'
import { SubtitleOverlay } from './SubtitleOverlay.tsx'
import { idleGesture, type SeekSide, settled, type TapGesture, tapped } from './tap-gestures.ts'
import { Timeline } from './Timeline.tsx'
import { TrackToast } from './TrackToast.tsx'
import { useControlsInset } from './use-controls-inset.ts'
import { useMediaSession } from './use-media-session.ts'
import { useNextEpisode } from './use-next-episode.ts'
import { useStore } from './use-store.ts'
import './player.css'

const seekStepMs = 10_000
const volumeStep = 0.1
const idleDelayMs = 3000
const rippleFadeMs = 250
// Kept equal to the transitions of `.player--pinch-settling` and `.player--pinch-closing`.
const pinchSettleMs = 240
const pinchCloseMs = 180

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
 * The player's page (§10.7): reads the controller of @projo/player and the
 * engine it was given, acts through them. Never picks or imports an engine.
 */
export const PlayerPage = ({
  itemId,
  fromStart,
  engine,
}: {
  itemId: string
  fromStart: boolean
  engine: WebPlayerEngine
}) => {
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

  const [idle, setIdle] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>()
  const [languagesTab, setLanguagesTab] = useState<LanguagesTab>('subtitles')
  const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>(loadSubtitleSettings)
  const [seekRipple, setSeekRipple] = useState<{
    side: SeekSide
    steps: number
    x: number
    y: number
    tap: number
    fading: boolean
  }>()
  const [tapWait, setTapWait] = useState<{ ms: number; taps: TapGesture }>()
  const [volumeHud, setVolumeHud] = useState<number>()
  const [pinchStage, setPinchStage] = useState<'idle' | 'active' | 'settling' | 'closing'>('idle')

  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // What the controller calls back into the page, kept current by an effect.
  const pageActions = useRef({ playNext: () => {}, exit: () => {} })
  const gestureRef = useRef<{
    pointer: string
    start?: { x: number; y: number; volume: number; height: number; dragging: boolean } | undefined
    taps: TapGesture
    // Touch pointers down on the surface, by pointer id.
    touches: Map<number, PinchPoint>
    pinch?: { ids: [number, number]; state: Pinch } | undefined
    // Set once a second finger went down: the fingers left after it are
    // neither a tap nor a volume drag until they are all up.
    ignoring: boolean
  }>({ pointer: 'mouse', taps: idleGesture, touches: new Map(), ignoring: false })

  const [controller] = useState(() =>
    createPlayerController({
      itemId,
      fromStart,
      engine,
      api: {
        ...playbackApi,
        updateProfile: (id, body) => updateProfile.mutateAsync({ id, body }),
      },
      ends: sessionEnds,
      timers: browserTimers,
      clock: browserClock,
      storage: browserStorage,
      page: browserPage,
      subtitleDelayMs: subtitleSettings.delayMs,
      onLetGo: () => void queryClient.invalidateQueries({ queryKey: ['catalog'] }),
      onSwitch: () => setOverlay(undefined),
      onPlayNext: () => pageActions.current.playNext(),
      onExit: () => pageActions.current.exit(),
    }),
  )

  const slotRef: RefCallback<HTMLDivElement> = useCallback(
    (node) => {
      if (node) node.append(engine.media)
    },
    [engine],
  )
  const [container, containerRef] = useElement<HTMLDivElement>()
  const [controls, controlsRef] = useElement<HTMLDivElement>()
  useControlsInset(container, controls)
  usePlayerFullscreenScope()
  const [trackElement, trackRef] = useElement<HTMLTrackElement>()
  const state = useStore(controller)
  const media = useStore(engine.state)
  const fullscreen = useIsFullscreen()
  const nativeFullscreen = useStore(engine.nativeFullscreen.active)
  const pip = useStore(engine.pictureInPicture.active)
  const pipStage = useStore(engine.pictureInPicture.stage)
  const airPlay = useStore(engine.airPlay.available)

  const scope = item.data?.kind === 'episode' ? 'series' : 'movie'
  const context: PlayerContext = useMemo(
    () => ({ itemDurationMs: item.data?.durationMs, scope, profile, next: next.status }),
    [item.data?.durationMs, scope, profile, next.status],
  )
  const view = playerView(state, media, context)
  const { session, positionMs, totalMs, bufferedMs, streamMs, blocked, failure, networkLost } = view
  const hlsSubtitles = state.subtitles === 'hls'

  useEffect(() => controller.setContext(context), [controller, context])
  useEffect(() => {
    controller.start()
    return () => controller.stop()
  }, [controller])
  useEffect(() => () => engine.pictureInPicture.leave(), [engine])

  const chapters =
    session === undefined ? [] : chaptersOnItem(session.chapters, session.partOffsetMs)
  const zones = session === undefined ? [] : segmentZones(session.segments, totalMs)
  const trickplayUrl = session?.trickplayUrl
  const trickplay = useQuery({
    queryKey: ['trickplay', trickplayUrl],
    queryFn: () => fetchTrickplayIndex(trickplayUrl ?? ''),
    enabled: trickplayUrl !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  const { audioIndex, subtitleId } = view
  const vttTrack =
    session === undefined || state.subtitles !== 'overlay'
      ? undefined
      : vttTrackOf(session.subtitleTracks, subtitleId)

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

  const nextEpisode = next.status === 'found' ? next.episode : undefined

  useEffect(() => {
    pageActions.current = {
      playNext: () => {
        if (nextEpisode !== undefined) playEpisode(nextEpisode)
      },
      exit,
    }
  }, [nextEpisode, playEpisode, exit])

  useServerEvent('playback.session_terminated', (payload) => controller.sessionTerminated(payload))

  useEffect(() => {
    if (!networkLost) return
    const online = () => controller.retryNetwork()
    const visible = () => {
      if (document.visibilityState === 'visible') controller.retryNetwork()
    }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [controller, networkLost])

  useEffect(
    () => controller.setSubtitleDelay(subtitleSettings.delayMs),
    [controller, subtitleSettings.delayMs],
  )

  const changeSubtitleSettings = (update: (settings: SubtitleSettings) => SubtitleSettings) =>
    setSubtitleSettings(update)

  useEffect(() => saveSubtitleSettings(subtitleSettings), [subtitleSettings])

  const { toast, skipped } = state

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
    const opener =
      overlay === undefined
        ? undefined
        : container?.querySelector<HTMLButtonElement>(`[data-menu="${overlay}"]`)
    setOverlay(undefined)
    opener?.focus()
  }

  const togglePlay = () => controller.togglePlay()
  const seekToItem = (target: number) => controller.seekToItem(target)
  const seekBy = (deltaMs: number) => controller.seekBy(deltaMs)
  const setVolume = (volume: number) => controller.setVolume(volume)
  const toggleMute = () => controller.toggleMute()
  const toggleFull = () =>
    toggleFullscreen({
      available: engine.capabilities.nativeFullscreen,
      enter: engine.nativeFullscreen.enter,
    })

  const { skippable, skipView, nextUpView, countdown: activeCountdown, countdownStart } = view
  const skippableKey = skippable === undefined ? undefined : segmentKey(skippable)
  // The full "Next episode" screen, at the end of the file only.
  const nextUpShown = nextUpView === 'screen'
  const countdownView: NextUpCountdownView =
    activeCountdown === undefined || activeCountdown.leftMs === undefined
      ? undefined
      : {
          seconds: secondsLeft(activeCountdown) ?? 0,
          ratio: countdownRatio(activeCountdown, countdownStart),
        }

  const posterUrl = item.data?.series?.images?.poster ?? item.data?.images.poster
  const nowPlaying = useMemo(
    () => (title === '' ? undefined : nowPlayingOf({ title, subtitle, posterUrl })),
    [title, subtitle, posterUrl],
  )
  useMediaSession({
    engine,
    metadata: nowPlaying,
    seekBy,
    next: nextEpisode === undefined ? undefined : () => playEpisode(nextEpisode),
  })

  const nextDetail = useQuery({
    ...itemQuery(nextEpisode?.id ?? ''),
    enabled: nextEpisode !== undefined,
  })

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
        return setVolume(engine.read().volume + volumeStep)
      case 'volume_down':
        return setVolume(engine.read().volume - volumeStep)
      case 'toggle_mute':
        return toggleMute()
      case 'toggle_fullscreen':
        return toggleFull()
      case 'skip_segment':
        return controller.skipSegment()
      case 'next_episode':
        if (nextEpisode !== undefined) playEpisode(nextEpisode)
        return
      case 'toggle_subtitles':
        return controller.toggleSubtitles()
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

  // A single tap toggles the controls once no second tap can follow; a seek
  // series fades its ripple out once the taps stop (§10.7).
  const settleTaps = useEffectEvent((waited: TapGesture) => {
    const gesture = gestureRef.current
    if (gesture.taps !== waited) return
    const wasSeeking = gesture.taps.kind === 'seeking'
    const { gesture: next, toggleControls } = settled(gesture.taps)
    gesture.taps = next
    if (toggleControls) {
      if (idle) wake()
      else setIdle(true)
    }
    if (wasSeeking) setSeekRipple((shown) => shown && { ...shown, fading: true })
  })

  useEffect(() => {
    if (tapWait === undefined) return
    const timer = setTimeout(() => settleTaps(tapWait.taps), tapWait.ms)
    return () => clearTimeout(timer)
  }, [tapWait])

  const rippleFading = seekRipple?.fading === true
  useEffect(() => {
    if (!rippleFading) return
    const timer = setTimeout(() => setSeekRipple(undefined), rippleFadeMs)
    return () => clearTimeout(timer)
  }, [rippleFading])

  // A pinch in closes the player like its close button (§10.7); the video
  // follows the fingers through `--player-pinch-scale`, set without a render.
  const showPinchScale = (scale: number) =>
    container?.style.setProperty('--player-pinch-scale', String(scale))

  const onPinchEnded = useEffectEvent(() => {
    if (pinchStage !== 'closing') return
    exit()
  })

  useEffect(() => {
    if (pinchStage === 'settling') {
      const timer = setTimeout(() => setPinchStage('idle'), pinchSettleMs)
      return () => clearTimeout(timer)
    }
    if (pinchStage !== 'closing') return
    const timer = setTimeout(onPinchEnded, matchMedia(reducedMotion).matches ? 0 : pinchCloseMs)
    return () => clearTimeout(timer)
  }, [pinchStage])

  // Safari zooms the page on a pinch whatever `touch-action` says; inside the
  // player only, the rest of the app keeps its zoom.
  useEffect(() => {
    if (container === undefined) return
    const prevent = (event: Event) => event.preventDefault()
    container.addEventListener('gesturestart', prevent)
    container.addEventListener('gesturechange', prevent)
    return () => {
      container.removeEventListener('gesturestart', prevent)
      container.removeEventListener('gesturechange', prevent)
    }
  }, [container])

  // A second finger cancels the tap or volume drag of the first one, and starts
  // a pinch unless a menu or panel is open.
  const onSecondTouch = (time: number) => {
    const gesture = gestureRef.current
    const start = gesture.start
    gesture.start = undefined
    gesture.ignoring = true
    if (start?.dragging === true) {
      setVolume(start.volume)
      setVolumeHud(undefined)
    }
    if (gesture.taps.kind !== 'idle') {
      gesture.taps = idleGesture
      setTapWait(undefined)
      setSeekRipple((shown) => shown && { ...shown, fading: true })
    }
    const [first, second] = [...gesture.touches.entries()]
    if (
      first === undefined ||
      second === undefined ||
      gesture.touches.size !== 2 ||
      overlay !== undefined ||
      nextUpShown ||
      pinchStage === 'closing'
    )
      return
    gesture.pinch = { ids: [first[0], second[0]], state: pinchStarted(first[1], second[1], time) }
    showPinchScale(1)
    setPinchStage('active')
  }

  const onPinchPointerUp = (pointerId: number, time: number, cancelled: boolean) => {
    const gesture = gestureRef.current
    const pinch = gesture.pinch
    if (pinch === undefined || !pinch.ids.includes(pointerId)) return
    gesture.pinch = undefined
    setPinchStage(!cancelled && pinchCloses(pinch.state, time) ? 'closing' : 'settling')
  }

  // Drops a lifted touch; true while the fingers left belong to a pinch.
  const touchLifted = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const gesture = gestureRef.current
    gesture.touches.delete(event.pointerId)
    onPinchPointerUp(event.pointerId, event.timeStamp, cancelled)
    if (!gesture.ignoring) return false
    gesture.start = undefined
    if (gesture.touches.size === 0) gesture.ignoring = false
    return true
  }

  const onSurfacePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    gesture.pointer = event.pointerType
    if (event.pointerType === 'mouse') return
    // The first finger of a touch: whatever was left of an earlier one is stale.
    if (event.isPrimary) {
      gesture.touches.clear()
      gesture.ignoring = false
    }
    gesture.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (gesture.touches.size > 1) {
      if (gesture.pinch === undefined) onSecondTouch(event.timeStamp)
      return
    }
    if (gesture.ignoring) return
    const rect = event.currentTarget.getBoundingClientRect()
    gesture.start = {
      x: event.clientX,
      y: event.clientY,
      volume: engine.read().volume,
      height: rect.height,
      dragging: false,
    }
  }

  const onSurfacePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (gesture.touches.has(event.pointerId))
      gesture.touches.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const pinch = gesture.pinch
    if (pinch !== undefined) {
      const a = gesture.touches.get(pinch.ids[0])
      const b = gesture.touches.get(pinch.ids[1])
      if (!pinch.ids.includes(event.pointerId) || a === undefined || b === undefined) return
      const state = pinchMoved(pinch.state, a, b, event.timeStamp)
      gesture.pinch = { ...pinch, state }
      showPinchScale(state.scale)
      return
    }
    const start = gesture.start
    if (start === undefined) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.dragging && isVerticalDrag(dx, dy) && engine.capabilities.volume)
      start.dragging = true
    if (!start.dragging) return
    const volume = volumeAfterDrag(start.volume, dy, start.height)
    setVolume(volume)
    setVolumeHud(volume)
  }

  const onSurfacePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (event.pointerType !== 'mouse' && touchLifted(event, false)) return
    const start = gesture.start
    gesture.start = undefined
    if (event.pointerType === 'mouse' || start === undefined) return
    if (start.dragging) {
      setVolumeHud(undefined)
      return
    }
    if (overlay !== undefined) {
      gesture.taps = idleGesture
      setTapWait(undefined)
      closeOverlay()
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const step = tapped(gesture.taps, { time: event.timeStamp, zone: tapZone(x, rect.width) })
    gesture.taps = step.gesture
    setTapWait({ ms: step.settleAfterMs, taps: step.gesture })
    const seek = step.seek
    if (seek === undefined) return
    seekBy(seek.side === 'left' ? -seekStepMs : seekStepMs)
    setSeekRipple((shown) => ({
      side: seek.side,
      steps: seek.steps,
      x,
      y,
      tap: (shown?.tap ?? 0) + 1,
      fading: false,
    }))
  }

  const onSurfaceClick = () => {
    if (gestureRef.current.pointer !== 'mouse') return
    if (overlay !== undefined) closeOverlay()
    else togglePlay()
  }

  const { loading, itemEnded } = view
  const interruption = state.interruption
  const showEnd = itemEnded && !blocked && !nextUpShown
  const chromeVisible =
    !idle || media.paused || blocked || overlay !== undefined || showEnd || nextUpShown
  const canAct = session !== undefined && !blocked
  const muted = media.muted || media.volume === 0
  const landingFor = (ms: number) => (session === undefined ? ms : snapToSeekPoint(session, ms))
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
      className={`player${chromeVisible ? '' : ' player--idle'}${nextUpShown ? ' player--next-up' : ''}${overlay === 'languages' ? ' player--menu' : ''}${pinchStage === 'idle' ? '' : ` player--pinch-${pinchStage}`}`}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') wake()
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') wake()
      }}
    >
      <div ref={slotRef} className="player__video-slot" />
      {vttTrack === undefined || vttTrack.url === undefined
        ? undefined
        : createPortal(
            <track
              key={`${session?.id ?? ''}-${vttTrack.id}`}
              ref={trackRef}
              kind="subtitles"
              src={vttTrack.url}
              {...(vttTrack.language === undefined ? {} : { srcLang: vttTrack.language })}
              label={vttTrack.title ?? vttTrack.language ?? ''}
            />,
            engine.media,
          )}

      {pipStage === undefined ? (
        <SubtitleOverlay
          key={vttTrack === undefined ? 'off' : `${session?.id ?? ''}-${vttTrack.id}`}
          element={vttTrack === undefined ? undefined : trackElement}
          delayMs={subtitleSettings.delayMs}
          size={subtitleSettings.size}
          raised={chromeVisible}
          aboveToast={
            (toast !== undefined || skipped !== undefined || nextUpView === 'bubble') && !blocked
          }
          native={nativeFullscreen || (pip && engine.pictureInPicture.showsTextTracks())}
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
        onPointerCancel={(event) => {
          if (event.pointerType !== 'mouse') touchLifted(event, true)
          gestureRef.current.start = undefined
          setVolumeHud(undefined)
        }}
        onClick={onSurfaceClick}
        onDoubleClick={() => {
          if (gestureRef.current.pointer === 'mouse') toggleFull()
        }}
        aria-hidden="true"
      />

      {seekRipple === undefined ? undefined : (
        <div
          key={seekRipple.side}
          className={`player__seek-ripple player__seek-ripple--${seekRipple.side}${seekRipple.fading ? ' player__seek-ripple--fading' : ''}`}
          aria-hidden="true"
        >
          <span
            key={seekRipple.tap}
            className="player__seek-ripple-wave"
            style={{ left: seekRipple.x, top: seekRipple.y }}
          />
          <span className="player__seek-ripple-label">
            <SeekArrowsIcon direction={seekRipple.side === 'left' ? 'back' : 'forward'} />
            {t(seekRipple.side === 'left' ? 'player.seekTotal.back' : 'player.seekTotal.forward', {
              seconds: (seekRipple.steps * seekStepMs) / 1000,
            })}
          </span>
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

      {!loading && !blocked && !showEnd && !nextUpShown && overlay === undefined && media.paused ? (
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
            aria-label={media.paused ? t('player.play') : t('player.pause')}
            tabIndex={-1}
            onClick={togglePlay}
          >
            {media.paused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
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
          onSkip={() => controller.skipOver(skippable)}
        />
      ) : undefined}

      {skipped === undefined || blocked ? undefined : (
        <SkippedToast key={skipped.id} segment={skipped.segment} onUndo={controller.undoSkip} />
      )}

      {toast === undefined || blocked ? undefined : (
        <TrackToast
          toast={toast}
          canSetDefault={toastCanDefault}
          onSetDefault={controller.setProfileDefault}
          onUndo={controller.undoMemory}
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
            <button type="button" className="button button--primary" onClick={controller.restart}>
              {t('common.retry')}
            </button>
          </div>
        </div>
      ) : undefined}

      {nextUpView === 'bubble' && nextEpisode !== undefined ? (
        <NextUpBubble
          countdown={countdownView}
          onPlay={() => playEpisode(nextEpisode)}
          onWatchCredits={controller.watchCredits}
        />
      ) : undefined}

      {nextUpShown && nextEpisode !== undefined ? (
        <>
          <NextUpCard
            next={nextEpisode}
            detail={nextDetail.data}
            fallbackArt={item.data?.series?.images?.backdrop ?? item.data?.images.backdrop}
            countdown={countdownView}
            onPlay={() => playEpisode(nextEpisode)}
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
              onAudio={controller.chooseAudio}
              onSubtitle={controller.chooseSubtitle}
              subtitleSettings={subtitleSettings}
              onSubtitleSettings={changeSubtitleSettings}
              sizeAdjustable={!hlsSubtitles}
            />
          ) : overlay === 'speed' ? (
            <SpeedMenu rate={state.rate} onRate={controller.setRate} onClose={closeOverlay} />
          ) : overlay === 'quality' ? (
            <QualityMenu
              session={session}
              onQuality={(quality: PlaybackQuality) => controller.chooseQuality(quality)}
              onVersion={controller.chooseVersion}
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

      <div ref={controlsRef} className="player__bottom" inert={nextUpShown}>
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
            landingAt={landingFor}
            onSeek={(target) => seekToItem(landingFor(target))}
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
            aria-label={media.paused ? t('player.play') : t('player.pause')}
            disabled={!canAct}
            onClick={togglePlay}
          >
            {media.paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
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
              aria-label={media.muted ? t('player.unmute') : t('player.mute')}
              onClick={toggleMute}
            >
              {muted ? <MutedIcon size={22} /> : <VolumeIcon size={22} />}
            </button>
            <div className="volume__slider">
              <progress
                className="volume__level"
                value={muted ? 0 : media.volume}
                max={1}
                aria-hidden="true"
              />
              <input
                className="volume__input"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : media.volume}
                aria-label={t('player.volume')}
                aria-valuetext={`${Math.round((muted ? 0 : media.volume) * 100)} %`}
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
          {engine.capabilities.pictureInPicture ? (
            <button
              type="button"
              className="player__control player__control--pip"
              aria-label={t('player.menu.pip')}
              aria-pressed={pip}
              onClick={engine.pictureInPicture.toggle}
            >
              <PictureInPictureIcon size={21} />
            </button>
          ) : undefined}
          {airPlay ? (
            <button
              type="button"
              className="player__control"
              aria-label={t('player.menu.airplay')}
              onClick={engine.airPlay.showPicker}
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
