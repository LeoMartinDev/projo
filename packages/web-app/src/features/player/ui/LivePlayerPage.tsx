import { useQuery } from '@tanstack/react-query'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import {
  type PointerEvent,
  type SyntheticEvent,
  type RefCallback,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { createLiveController } from '@projo/player/application/live-controller'
import { liveView } from '@projo/player/application/live-view'
import { adjacentChannel } from '@projo/player/core/live'
import { createStore } from '@projo/player/core/store'
import type { TvChannelDto, TvChannelsResponse } from '@projo/shared/api/tv'

import { mediaUrl } from '../../../shared/api/media.ts'
import { useServerEvent } from '../../../shared/events/events.ts'
import { useErrorMessage } from '../../../shared/i18n/errors.ts'
import { useNow } from '../../../shared/ui/use-now.ts'
import { CloseIcon, MutedIcon, PauseIcon, PlayIcon, VolumeIcon } from '../../../shared/ui/icons.tsx'
import { isTextEntry } from '../../../shared/ui/focusable.ts'
import { type Direction } from '../../../shared/ui/spatial-nav/geometry.ts'
import { claimIntents } from '../../../shared/ui/spatial-nav/intents.ts'
import {
  browserBackKeys,
  keyOfDirection,
  type MediaAction,
  type NavIntent,
} from '../../../shared/ui/spatial-nav/keys.ts'
import { activateFocus, moveFocus } from '../../../shared/ui/spatial-nav/spatial-nav.ts'
import { useElement } from '../../../shared/ui/use-element.ts'
import { ChannelLogo } from '../../tv/ChannelLogo.tsx'
import { clockTime } from '../../tv/guide-format.ts'
import { episodeLine } from '../../tv/programme-format.ts'
import { ProgrammeDialog } from '../../tv/ProgrammeDialog.tsx'
import {
  channelOrder,
  channelSections,
  elapsedOf,
  type OnAir,
  onAirAt,
  tvChannelsQuery,
  tvGuideQuery,
  withGuide,
} from '../../tv/queries.ts'
import {
  toggleFullscreen,
  useIsFullscreen,
  usePlayerFullscreenScope,
  useWindowFullscreenScope,
} from '../fullscreen.ts'
import {
  browserPage,
  browserStorage,
  browserTimers,
  liveSessionEnds,
  liveTvApi,
} from '../playback-api.ts'
import type { WebPlayerEngine } from '../web-engine.ts'
import { onMenuKeyDown, useMenuFocus } from './menu-focus.ts'
import {
  AirPlayIcon,
  ChannelListIcon,
  ChannelStepIcon,
  CornersIcon,
  CornersInIcon,
  ExitArrowIcon,
  PictureInPictureIcon,
} from './player-icons.tsx'
import { focusedControlOf, type KeyInput, type LiveCommand, liveCommandFor } from './shortcuts.ts'
import { usePictureBehindPage } from './use-picture-behind-page.ts'
import { useMediaSession } from './use-media-session.ts'
import { usePlayerFocus } from './use-player-focus.ts'
import { useStore } from './use-store.ts'
import './player.css'
import './live-player.css'

const notInWindowFullscreen = createStore(false)
const volumeStep = 0.1
const idleDelayMs = 3000

const focusDirections = {
  focus_up: 'up',
  focus_down: 'down',
  focus_left: 'left',
  focus_right: 'right',
} as const satisfies Record<string, Direction>

// A gamepad's playback buttons (§19): LB/RB step through the channels (§29.5).
const mediaCommands: Record<MediaAction, LiveCommand> = {
  toggle_play: 'toggle_play',
  seek_back: 'previous_channel',
  seek_forward: 'next_channel',
}

const inOverlay = (target: EventTarget | undefined) =>
  target instanceof Element && (target.closest('[data-player-overlay]') ?? undefined) !== undefined

const focusedControl = (target: EventTarget | undefined, keyboardFocused: boolean) =>
  target instanceof HTMLElement && target !== document.body
    ? focusedControlOf({
        tagName: target.tagName,
        type: target instanceof HTMLInputElement ? target.type : undefined,
        role: target.getAttribute('role') ?? undefined,
        keyboardFocused,
      })
    : undefined

const channelLabel = (channel: Pick<TvChannelDto, 'name' | 'number'>) =>
  channel.number === undefined ? channel.name : `${channel.number} ${channel.name}`

/** Keeps the player's own keys, taps and clicks out of the detail opened over it. */
const stopPropagation = (event: SyntheticEvent) => event.stopPropagation()

/** The programme on now's image, a 16:9 thumbnail of the block's height (§29.6); none without. */
const LiveThumb = ({ onAir }: { onAir: OnAir }) => {
  const [failed, setFailed] = useState<string>()
  const url = onAir.now?.imageUrl
  if (url === undefined || failed === url) return undefined
  return (
    <img
      className="live-heading__thumb"
      src={mediaUrl(url)}
      alt=""
      decoding="async"
      draggable={false}
      onError={() => setFailed(url)}
    />
  )
}

/**
 * The programme on now and the next one under the channel (§29.5, §29.6): the title (opening its
 * detail), its episode in place of its times when it has one, the elapsed bar, then the next one;
 * nothing without a guide.
 */
const LiveGuide = ({
  onAir,
  at,
  channel,
}: {
  onAir: OnAir
  at: number
  channel: TvChannelDto | undefined
}) => {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<string>()
  const { now, next } = onAir
  if (now === undefined && next === undefined) return undefined
  const episode = now === undefined ? undefined : episodeLine(t, now)
  const programmeId = now?.id
  return (
    <>
      {now === undefined ? undefined : (
        <span className="live-heading__now">
          {programmeId === undefined ? (
            <span className="live-heading__now-title">{now.title}</span>
          ) : (
            <button
              type="button"
              className="live-heading__now-title live-heading__now-open"
              aria-label={t('tv.information', { title: now.title })}
              onClick={() => setDetail(programmeId)}
            >
              {now.title}
            </button>
          )}
          <span className="live-heading__times">
            {episode ?? `${clockTime(now.startAt)} – ${clockTime(now.endAt)}`}
          </span>
          <span className="live-heading__progress" aria-hidden="true">
            <span
              className="live-heading__progress-bar"
              style={{ transform: `scaleX(${elapsedOf(now, at)})` }}
            />
          </span>
        </span>
      )}
      {next === undefined ? undefined : (
        <span className="live-heading__next">
          <span className="live-heading__times">{clockTime(next.startAt)}</span> {next.title}
        </span>
      )}
      {detail === undefined ? undefined : (
        // The player's keys, taps and clicks stay out of the dialog over it.
        <span
          className="live-heading__detail"
          onKeyDown={stopPropagation}
          onPointerDown={stopPropagation}
          onPointerUp={stopPropagation}
          onClick={stopPropagation}
          onDoubleClick={stopPropagation}
          onContextMenu={stopPropagation}
        >
          <ProgrammeDialog
            programmeId={detail}
            channel={channel}
            watch={false}
            onClose={() => setDetail(undefined)}
          />
        </span>
      )}
    </>
  )
}

/** The channel list over the picture (§29.5): page order, the current channel marked. */
const ChannelList = ({
  channels,
  currentId,
  at,
  onPick,
  onClose,
}: {
  channels: TvChannelsResponse | undefined
  currentId: string
  at: number
  onPick: (channelId: string) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const sections = channels === undefined ? [] : channelSections(channels)
  return (
    <>
      <div className="episodes-panel__head">
        <h2 className="episodes-panel__title">{t('player.live.channels')}</h2>
        <button
          type="button"
          className="player__control player__control--small"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="episodes-panel__list live-channels__list" data-arrow-list>
        {sections.map(({ id, group, channels: items }) => (
          <section key={id} className="live-channels__section">
            <h3 className="live-channels__group">
              {group === undefined
                ? t('tv.favorites')
                : group.name === ''
                  ? t('tv.otherChannels')
                  : group.name}
            </h3>
            <ol className="live-channels__items">
              {items.map((channel) => {
                const current = channel.id === currentId
                const now = onAirAt(channel, at).now
                return (
                  <li key={channel.id}>
                    <button
                      type="button"
                      className="live-channels__row"
                      aria-current={current ? 'true' : undefined}
                      aria-label={channelLabel(channel)}
                      onClick={() => (current ? onClose() : onPick(channel.id))}
                    >
                      <span className="live-channels__logo">
                        <ChannelLogo channel={channel} className="live-channels__logo-img" />
                      </span>
                      <span className="live-channels__number" aria-hidden="true">
                        {channel.number}
                      </span>
                      <span className="live-channels__text" aria-hidden="true">
                        <span className="live-channels__name">{channel.name}</span>
                        {now === undefined ? undefined : (
                          <span className="live-channels__now">{now.title}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </div>
    </>
  )
}

/**
 * The live player's page (§29.5): reads the live controller of @projo/player and the engine
 * it was given, acts through them. Never picks or imports an engine.
 */
export const LivePlayerPage = ({
  channelId,
  engine,
}: {
  channelId: string
  engine: WebPlayerEngine
}) => {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const listed = useQuery(tvChannelsQuery)
  const guide = useQuery(tvGuideQuery)
  const at = useNow().getTime()
  const channels = useMemo(
    () => ({
      data: listed.data === undefined ? undefined : withGuide(listed.data, guide.data),
    }),
    [listed.data, guide.data],
  )
  const order = useMemo(
    () => (channels.data === undefined ? [] : channelOrder(channels.data)),
    [channels.data],
  )

  const [idle, setIdle] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pointer = useRef('mouse')

  const [controller] = useState(() =>
    createLiveController({
      channelId,
      engine,
      api: liveTvApi,
      ends: liveSessionEnds,
      timers: browserTimers,
      storage: browserStorage,
      page: browserPage,
    }),
  )

  const slotRef: RefCallback<HTMLDivElement> = useCallback(
    (node) => {
      if (node) node.append(engine.media)
    },
    [engine],
  )
  const [container, containerRef] = useElement<HTMLDivElement>()
  const [menu, menuRef] = useElement<HTMLDivElement>()
  usePlayerFullscreenScope()
  useWindowFullscreenScope(engine.windowFullscreen)
  const state = useStore(controller)
  const media = useStore(engine.state)
  const documentFullscreen = useIsFullscreen()
  const windowFullscreen = useStore(engine.windowFullscreen?.active ?? notInWindowFullscreen)
  const fullscreen = engine.windowFullscreen === undefined ? documentFullscreen : windowFullscreen
  const pip = useStore(engine.pictureInPicture.active)
  const airPlay = useStore(engine.airPlay.available)
  const { failure, networkLost, blocked, loading, playing } = liveView(state, media)
  const interruption = state.interruption
  const channel = channels.data?.items.find((item) => item.id === state.channelId)
  const onAir = channel === undefined ? {} : onAirAt(channel, at)

  // The URL names the channel (zapping replaces it): the controller follows it.
  useEffect(() => controller.zap(channelId), [controller, channelId])
  useEffect(() => {
    controller.start()
    return () => controller.stop()
  }, [controller])
  useEffect(() => () => engine.pictureInPicture.leave(), [engine])
  // After the controller's stop (declared above, cleaned up first).
  useEffect(() => () => engine.release(), [engine])

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

  const exit = useCallback(() => {
    if (canGoBack) router.history.back()
    else void navigate({ to: '/tv', replace: true })
  }, [canGoBack, navigate, router])

  const zapTo = useCallback(
    (id: string) =>
      void navigate({ to: '/watch/tv/$channelId', params: { channelId: id }, replace: true }),
    [navigate],
  )
  const stepChannel = (step: 1 | -1) => {
    const target = adjacentChannel(order, state.channelId, step)
    if (target !== undefined) zapTo(target)
  }
  const canStep = adjacentChannel(order, state.channelId, 1) !== undefined

  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), idleDelayMs)
  }, [])

  useEffect(() => {
    idleTimer.current = setTimeout(() => setIdle(true), idleDelayMs)
    return () => clearTimeout(idleTimer.current)
  }, [])

  const playerFocus = usePlayerFocus(container, wake)

  const closeList = () => {
    setListOpen(false)
    container?.querySelector<HTMLButtonElement>('[data-menu="channels"]')?.focus()
  }

  const togglePlay = () => controller.togglePlay()
  const setVolume = (volume: number) => controller.setVolume(volume)
  const toggleFull = () => {
    if (engine.windowFullscreen !== undefined) engine.windowFullscreen.set(!fullscreen)
    else
      toggleFullscreen({
        available: engine.capabilities.nativeFullscreen,
        enter: engine.nativeFullscreen.enter,
      })
  }

  // The title on now as subtitle when the guide knows it (§29.5).
  const nowTitle = onAir.now?.title
  const channelName = channel?.name
  const channelLogo = channel?.logoUrl
  const nowPlaying = useMemo(
    () =>
      channelName === undefined
        ? undefined
        : {
            title: channelName,
            subtitle: nowTitle ?? t('player.live.nowPlaying'),
            ...(channelLogo === undefined ? {} : { artworkUrl: mediaUrl(channelLogo) }),
          },
    [channelName, channelLogo, nowTitle, t],
  )
  useMediaSession({
    engine,
    metadata: nowPlaying,
    seekBy: undefined,
    next: canStep ? () => stepChannel(1) : undefined,
  })

  const runCommand = (command: LiveCommand) => {
    switch (command) {
      case 'toggle_play':
        togglePlay()
        break
      case 'volume_up':
        setVolume(engine.read().volume + volumeStep)
        break
      case 'volume_down':
        setVolume(engine.read().volume - volumeStep)
        break
      case 'toggle_mute':
        controller.toggleMute()
        break
      case 'toggle_fullscreen':
        toggleFull()
        break
      case 'previous_channel':
        stepChannel(-1)
        break
      case 'next_channel':
        stepChannel(1)
        break
      case 'toggle_channels':
        setListOpen((open) => !open)
        break
      case 'focus_up':
      case 'focus_down':
      case 'focus_left':
      case 'focus_right':
        if (container !== undefined) moveFocus(focusDirections[command], container)
        break
      case 'focus_controls':
      case 'activate_prompt':
        playerFocus.focusControls()
        break
      case 'release_focus':
        playerFocus.release()
        clearTimeout(idleTimer.current)
        setIdle(true)
        break
      case 'close_overlay':
        closeList()
        break
      case 'exit':
        exit()
        break
    }
  }

  // Runs a key, from the keyboard or from an intent (a gamepad); true when the player took it.
  const runKey = (input: KeyInput, target: EventTarget | undefined, prevent: () => void) => {
    const command = liveCommandFor(input, {
      editing: isTextEntry(target),
      inOverlay: inOverlay(target),
      overlayOpen: listOpen,
      fullscreen,
      ownFullscreen: engine.windowFullscreen !== undefined,
      focusedControl: focusedControl(target, playerFocus.isKeyboardFocused(target)),
    })
    wake()
    // Taken even when nothing is left to do: the browser would go back itself (§10.7).
    if (browserBackKeys.includes(input.key)) prevent()
    if (command === undefined) return false
    if (input.key !== 'Escape' || (command !== 'exit' && command !== 'close_overlay')) prevent()
    runCommand(command)
    return true
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    runKey(event, event.target ?? undefined, () => event.preventDefault())
  })

  const onIntent = useEffectEvent((intent: NavIntent): boolean => {
    if (intent.kind === 'media' || intent.kind === 'menu') {
      wake()
      if (intent.kind === 'media') runCommand(mediaCommands[intent.action])
      return intent.kind === 'media'
    }
    const target = document.activeElement ?? undefined
    const key =
      intent.kind === 'move'
        ? keyOfDirection[intent.direction]
        : intent.kind === 'activate'
          ? 'Enter'
          : 'GoBack'
    if (runKey({ key, altKey: false, ctrlKey: false, metaKey: false }, target, () => {}))
      return true
    if (intent.kind === 'move')
      return moveFocus(
        intent.direction,
        target instanceof Element
          ? (target.closest('[data-player-overlay]') ?? container)
          : container,
      )
    return intent.kind === 'activate' && container !== undefined && activateFocus(container)
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    const release = claimIntents((intent) => onIntent(intent))
    return () => {
      window.removeEventListener('keydown', listener)
      release()
    }
  }, [])

  // A tap shows or hides the controls (or closes the list); a click plays or pauses.
  const onSurfacePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointer.current = event.pointerType
    if (event.pointerType === 'mouse') return
    if (listOpen) closeList()
    else if (idle) wake()
    else setIdle(true)
  }
  const onSurfaceClick = () => {
    if (pointer.current !== 'mouse') return
    if (listOpen) closeList()
    else togglePlay()
  }

  const chromeVisible = !idle || media.paused || blocked || listOpen
  useEffect(() => {
    if (!chromeVisible) playerFocus.rest()
  }, [chromeVisible, playerFocus])
  const behindPage = usePictureBehindPage({ engine, thumbnail: false })
  useMenuFocus(menu, listOpen ? 'channels' : undefined)
  const muted = media.muted || media.volume === 0
  const paused = media.paused

  return (
    <div
      ref={containerRef}
      className={`player player--live${behindPage ? ' player--behind-page' : ''}${engine.capabilities.backdropBlur ? '' : ' player--opaque-glass'}${chromeVisible ? '' : ' player--idle'}`}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') wake()
      }}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse') wake()
      }}
    >
      <div ref={slotRef} className="player__video-slot" />

      <div
        className="player__surface"
        onPointerDown={(event) => {
          pointer.current = event.pointerType
        }}
        onPointerUp={onSurfacePointerUp}
        onClick={onSurfaceClick}
        onDoubleClick={() => {
          if (pointer.current === 'mouse') toggleFull()
        }}
        aria-hidden="true"
      />

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

      {!loading && !blocked && !listOpen && paused ? (
        <button
          type="button"
          className="player__big-play"
          data-nav-skip
          aria-label={t('player.play')}
          onClick={togglePlay}
        >
          <PlayIcon size={34} />
        </button>
      ) : undefined}

      {blocked ? undefined : (
        <div className="player__touch" aria-hidden={!chromeVisible}>
          <button
            type="button"
            className="player__touch-button"
            aria-label={t('player.live.previous')}
            tabIndex={-1}
            disabled={!canStep}
            onClick={() => stepChannel(-1)}
          >
            <ChannelStepIcon direction="previous" size={28} />
          </button>
          <button
            type="button"
            className="player__touch-button player__touch-button--main"
            aria-label={paused ? t('player.play') : t('player.pause')}
            tabIndex={-1}
            disabled={!playing}
            onClick={togglePlay}
          >
            {paused ? <PlayIcon size={34} /> : <PauseIcon size={34} />}
          </button>
          <button
            type="button"
            className="player__touch-button"
            aria-label={t('player.live.next')}
            tabIndex={-1}
            disabled={!canStep}
            onClick={() => stepChannel(1)}
          >
            <ChannelStepIcon direction="next" size={28} />
          </button>
        </div>
      )}

      <div className="player__top" data-window-top>
        <button
          type="button"
          className="player__control"
          aria-label={t('player.quit')}
          onClick={exit}
        >
          <ExitArrowIcon size={22} />
        </button>
      </div>

      {blocked ? (
        <div className="player__overlay" role="alert">
          <p className="player__overlay-title">
            {interruption?.kind === 'terminated'
              ? interruption.reason === 'admin'
                ? t('player.terminatedByAdmin')
                : t('player.live.sessionEnded')
              : t('player.errorTitle')}
          </p>
          {failure === undefined ? undefined : (
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

      {listOpen ? (
        <div
          ref={menuRef}
          className="episodes-panel live-channels"
          data-player-overlay
          data-overlay="channels"
          role="dialog"
          aria-label={t('player.live.channels')}
          onKeyDown={onMenuKeyDown}
        >
          <ChannelList
            channels={channels.data}
            currentId={state.channelId}
            at={at}
            onPick={(id) => {
              zapTo(id)
              closeList()
            }}
            onClose={closeList}
          />
        </div>
      ) : undefined}

      <div className="player__bottom">
        <div className="player__controls" data-nav-row>
          <button
            type="button"
            className="player__control player__control--play player__control--pointer"
            aria-label={paused ? t('player.play') : t('player.pause')}
            disabled={!playing}
            onClick={togglePlay}
          >
            {paused ? <PlayIcon size={26} /> : <PauseIcon size={26} />}
          </button>
          <div className="volume">
            <button
              type="button"
              className="player__control"
              aria-label={media.muted ? t('player.unmute') : t('player.mute')}
              onClick={controller.toggleMute}
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
                data-nav-skip
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

          <div className="player__heading live-heading">
            {channel === undefined ? undefined : (
              <ChannelLogo channel={channel} className="live-heading__logo" />
            )}
            <LiveThumb onAir={onAir} />
            <span className="live-heading__text">
              <span className="live-heading__channel">
                {channel?.number === undefined ? undefined : (
                  <span className="live-heading__number">{channel.number}</span>
                )}
                <span className="player__title">{channel?.name ?? ''}</span>
              </span>
              <LiveGuide onAir={onAir} at={at} channel={channel} />
            </span>
          </div>

          <button
            type="button"
            className="player__control player__control--pointer"
            aria-label={t('player.live.previous')}
            disabled={!canStep}
            onClick={() => stepChannel(-1)}
          >
            <ChannelStepIcon direction="previous" size={22} />
          </button>
          <button
            type="button"
            className="player__control player__control--pointer"
            aria-label={t('player.live.next')}
            disabled={!canStep}
            onClick={() => stepChannel(1)}
          >
            <ChannelStepIcon direction="next" size={22} />
          </button>
          <button
            data-menu="channels"
            type="button"
            className="player__control"
            aria-label={t('player.live.channels')}
            aria-expanded={listOpen}
            aria-haspopup="dialog"
            onClick={() => setListOpen((open) => !open)}
          >
            <ChannelListIcon size={22} />
          </button>
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
