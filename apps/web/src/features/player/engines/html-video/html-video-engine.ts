import type { ClientCapabilities } from '@projo/shared/api/playback'

import type { EngineCapabilities, EngineLoad } from '@projo/player/core/engine'
import {
  type MediaEvent,
  mediaEventTypes,
  type MediaSnapshot,
  type MediaState,
  reduceMediaState,
} from '@projo/player/core/media-state'
import { createStore } from '@projo/player/core/store'
import { renditionLabel, withSubtitleOffset } from '@projo/player/core/subtitles'

import type { WebPlayerEngine } from '../../web-engine.ts'
import { browserMediaEnvironment, detectCapabilities } from './capabilities.ts'
import {
  documentPictureInPictureSupported,
  openDocumentPictureInPicture,
  showInDocumentPictureInPicture,
} from './document-pip.ts'
import { playerVideo } from './player-element.ts'
import { attachStream, createStreamReloader, loadHls } from './stream.ts'

// Kept equal to the class player.css styles the native cues with.
const nativeCuesClass = 'player__video--native-cues'
const subtitleReloadDelayMs = 800
const hlsMimeType = 'application/vnd.apple.mpegurl'

export const snapshotOf = (video: HTMLVideoElement): MediaSnapshot => {
  const { buffered } = video
  let bufferedEnd = 0
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= video.currentTime + 0.5) bufferedEnd = buffered.end(index)
  }
  return {
    paused: video.paused,
    ended: video.ended,
    seeking: video.seeking,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    bufferedEnd,
    volume: video.volume,
    muted: video.muted,
    ready: video.readyState >= 1,
    playbackRate: video.playbackRate,
  }
}

type WebkitVideo = {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
  webkitShowPlaybackTargetPicker?: () => void
  webkitEnterFullscreen?: () => void
}

const webkit = (video: HTMLVideoElement) => video as unknown as WebkitVideo

const volumeSettable = (video: HTMLVideoElement): boolean => {
  const before = video.volume
  const probe = before === 0.5 ? 0.6 : 0.5
  video.volume = probe
  const settable = Math.abs(video.volume - probe) < 0.01
  video.volume = before
  return settable
}

const inPictureInPicture = (video: HTMLVideoElement) =>
  document.pictureInPictureElement === video ||
  webkit(video).webkitPresentationMode === 'picture-in-picture'

const togglePictureInPicture = (video: HTMLVideoElement): void => {
  const presentation = webkit(video)
  if (typeof video.requestPictureInPicture === 'function' && document.pictureInPictureEnabled) {
    if (document.pictureInPictureElement === video)
      void document.exitPictureInPicture().catch(() => undefined)
    else void video.requestPictureInPicture().catch(() => undefined)
    return
  }
  presentation.webkitSetPresentationMode?.(
    presentation.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture',
  )
}

const capabilitiesOf = (video: HTMLVideoElement): EngineCapabilities => {
  const appleTouch = navigator.vendor.startsWith('Apple') && navigator.maxTouchPoints > 1
  return {
    pictureInPicture:
      document.pictureInPictureEnabled === true ||
      webkit(video).webkitSupportsPresentationMode?.('picture-in-picture') === true,
    airPlay: typeof webkit(video).webkitShowPlaybackTargetPicker === 'function',
    nativeFullscreen: typeof webkit(video).webkitEnterFullscreen === 'function',
    // The same rule as the detected `subtitleDelivery`: native HLS on an Apple touch device.
    subtitles: appleTouch && video.canPlayType(hlsMimeType) !== '' ? 'hls' : 'overlay',
    switchesAudioInPlace: false,
    rendersBehindPage: false,
    backdropBlur: true,
    volume: volumeSettable(video),
  }
}

const pipEvents = [
  'enterpictureinpicture',
  'leavepictureinpicture',
  'webkitpresentationmodechanged',
]

/**
 * The browser engine: a `<video>` with hls.js (or native HLS), the browser's
 * Picture-in-Picture (including the document one), AirPlay and native
 * fullscreen. The `<video>` is its media.
 */
export const createHtmlVideoEngine = (video: HTMLVideoElement): WebPlayerEngine => {
  const state = createStore<MediaState>({ ...snapshotOf(video), waiting: true })
  const listeners = new Set<(event: MediaEvent) => void>()
  const cleanups: (() => void)[] = []
  const listen = (target: EventTarget, type: string, listener: (event: Event) => void) => {
    target.addEventListener(type, listener)
    cleanups.push(() => target.removeEventListener(type, listener))
  }

  for (const type of mediaEventTypes) {
    listen(video, type, () => {
      const event: MediaEvent = { type, media: snapshotOf(video) }
      state.set(reduceMediaState(state.get(), event))
      for (const listener of [...listeners]) listener(event)
    })
  }

  let detected: Promise<ClientCapabilities> | undefined
  let resolved: ClientCapabilities | undefined
  const clientCapabilities = () => {
    detected ??= loadHls()
      .then((Hls) => detectCapabilities(browserMediaEnvironment(Hls.isSupported())))
      .then((capabilities) => {
        resolved = capabilities
        return capabilities
      })
    return detected
  }
  const hlsSubtitles = () => resolved?.subtitleDelivery === 'hls'

  const reloader = createStreamReloader(video)
  let current: EngineLoad | undefined
  let stopTrackSelection = () => {}
  let reloadTimer: ReturnType<typeof setTimeout> | undefined
  const cancelReloadTimer = () => clearTimeout(reloadTimer)

  // ── Picture-in-Picture ──
  const pipStage = createStore<HTMLElement | undefined>(undefined)
  const pipActive = createStore(false)
  const refreshPip = () => pipActive.set(inPictureInPicture(video) || pipStage.get() !== undefined)
  for (const type of pipEvents) listen(video, type, refreshPip)
  let closeStage: (() => void) | undefined
  const leaveStage = () => {
    const close = closeStage
    closeStage = undefined
    pipStage.set(undefined)
    refreshPip()
    close?.()
  }
  const showStage = (stage: HTMLElement) => {
    closeStage = showInDocumentPictureInPicture(stage, video, () => {
      closeStage = undefined
      pipStage.set(undefined)
      refreshPip()
    })
    pipStage.set(stage)
    refreshPip()
  }

  // ── AirPlay and native fullscreen (WebKit) ──
  const airPlayAvailable = createStore(false)
  listen(video, 'webkitplaybacktargetavailabilitychanged', (event) =>
    airPlayAvailable.set((event as Event & { availability?: string }).availability === 'available'),
  )
  const nativeFullscreen = createStore(false)
  listen(video, 'webkitbeginfullscreen', () => nativeFullscreen.set(true))
  listen(video, 'webkitendfullscreen', () => nativeFullscreen.set(false))

  return {
    media: video,
    state,
    read: () => snapshotOf(video),
    events: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    play: () => {
      video.play().catch(() => undefined)
    },
    pause: () => video.pause(),
    seek: (seconds) => {
      const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
      video.currentTime = Math.min(Math.max(0, seconds), duration)
    },
    setVolume: (volume, muted) => {
      video.volume = Math.min(1, Math.max(0, volume))
      video.muted = muted
    },
    setRate: (rate) => {
      video.defaultPlaybackRate = rate
      video.playbackRate = rate
    },
    load: (load, onFailure) => {
      const { session } = load
      const subtitlesInStream = hlsSubtitles()
      video.classList.toggle(nativeCuesClass, subtitlesInStream)
      const stream =
        subtitlesInStream && session.stream.type === 'hls'
          ? { ...session.stream, url: withSubtitleOffset(session.stream.url, load.subtitleDelayMs) }
          : session.stream
      current = load
      const detach = attachStream({
        video,
        stream,
        hlsMode: resolved?.hls === 'native' ? 'native' : 'mse',
        startSeconds: load.startSeconds,
        autoplay: load.autoplay,
        onFatal: onFailure,
      })
      return () => {
        if (current === load) current = undefined
        stopTrackSelection()
        stopTrackSelection = () => {}
        cancelReloadTimer()
        reloader.cancel()
        detach()
      }
    },
    selectAudio: () => {},
    // Native HLS renditions only (§10.4): the overlay draws WebVTT tracks itself.
    selectSubtitle: (track) => {
      stopTrackSelection()
      stopTrackSelection = () => {}
      if (current === undefined || !hlsSubtitles()) return
      const label = renditionLabel(current.session.subtitleTracks, track?.id)
      const apply = () => {
        for (const textTrack of Array.from(video.textTracks)) {
          if (textTrack.kind !== 'subtitles' && textTrack.kind !== 'captions') continue
          textTrack.mode = label !== undefined && textTrack.label === label ? 'showing' : 'disabled'
        }
      }
      apply()
      video.textTracks.addEventListener('addtrack', apply)
      stopTrackSelection = () => video.textTracks.removeEventListener('addtrack', apply)
    },
    // Native HLS renditions carry the offset in their URL: reload the stream with it.
    setSubtitleDelay: (delayMs) => {
      cancelReloadTimer()
      const stream = current?.session.stream
      if (stream?.type !== 'hls' || !hlsSubtitles()) return
      const url = withSubtitleOffset(stream.url, delayMs)
      if (video.src.endsWith(url)) return
      reloadTimer = setTimeout(() => reloader.reload(url), subtitleReloadDelayMs)
    },
    capabilities: capabilitiesOf(video),
    clientCapabilities,
    dispose: () => {
      leaveStage()
      for (const cleanup of cleanups.splice(0)) cleanup()
      listeners.clear()
    },
    pictureInPicture: {
      active: pipActive,
      stage: pipStage,
      toggle: () => {
        if (pipStage.get() !== undefined) leaveStage()
        else if (documentPictureInPictureSupported())
          void openDocumentPictureInPicture(video).then((stage) => {
            if (stage !== undefined) showStage(stage)
          })
        else togglePictureInPicture(video)
      },
      leave: leaveStage,
      showsTextTracks: () => webkit(video).webkitPresentationMode === 'picture-in-picture',
    },
    airPlay: {
      available: airPlayAvailable,
      showPicker: () => webkit(video).webkitShowPlaybackTargetPicker?.(),
    },
    nativeFullscreen: {
      active: nativeFullscreen,
      enter: () => webkit(video).webkitEnterFullscreen?.(),
    },
    // The picture is the page's own `<video>`; the overlay draws the subtitles.
    picture: { showing: createStore(false), place: () => {} },
    engineSubtitles: { setSize: () => {}, setBottom: () => {} },
    // The `<video>` is kept for the next player (§10.7).
    release: () => {},
  }
}

let shared: WebPlayerEngine | undefined

// One engine for the app's one `<video>` (kept across episodes, §10.7).
export const htmlVideoEngine = (): WebPlayerEngine => {
  shared ??= createHtmlVideoEngine(playerVideo())
  return shared
}
