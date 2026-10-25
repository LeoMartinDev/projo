import { useMemo, useSyncExternalStore } from 'react'

/** What the controls render, read from `<video>` on its own events (no polling). */
export type VideoState = {
  paused: boolean
  ended: boolean
  waiting: boolean
  currentTime: number
  duration: number
  bufferedEnd: number
  volume: number
  muted: boolean
  ready: boolean
}

const initialState: VideoState = {
  paused: true,
  ended: false,
  waiting: true,
  currentTime: 0,
  duration: 0,
  bufferedEnd: 0,
  volume: 1,
  muted: false,
  ready: false,
}

const events = [
  'play',
  'pause',
  'playing',
  'waiting',
  'seeking',
  'seeked',
  'timeupdate',
  'durationchange',
  'loadedmetadata',
  'canplay',
  'progress',
  'volumechange',
  'ended',
  'emptied',
] as const

const read = (video: HTMLVideoElement, waiting: boolean): VideoState => {
  const { buffered } = video
  let bufferedEnd = 0
  for (let index = 0; index < buffered.length; index += 1) {
    if (buffered.start(index) <= video.currentTime + 0.5) bufferedEnd = buffered.end(index)
  }
  return {
    paused: video.paused,
    ended: video.ended,
    waiting,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    bufferedEnd,
    volume: video.volume,
    muted: video.muted,
    ready: video.readyState >= 1,
  }
}

const same = (a: VideoState, b: VideoState) =>
  (Object.keys(a) as (keyof VideoState)[]).every((key) => a[key] === b[key])

const createVideoStore = (video: HTMLVideoElement) => {
  let waiting = true
  let snapshot = read(video, waiting)
  return {
    subscribe: (notify: () => void) => {
      const update = (event: Event) => {
        if (event.type === 'waiting' || event.type === 'seeking' || event.type === 'emptied')
          waiting = true
        if (event.type === 'playing' || event.type === 'canplay' || event.type === 'seeked')
          waiting = false
        if (event.type === 'pause') waiting = false
        const next = read(video, waiting)
        if (!same(next, snapshot)) {
          snapshot = next
          notify()
        }
      }
      for (const type of events) video.addEventListener(type, update)
      return () => {
        for (const type of events) video.removeEventListener(type, update)
      }
    },
    getSnapshot: () => snapshot,
  }
}

const idleStore = {
  subscribe: () => () => {},
  getSnapshot: () => initialState,
}

export const useVideoState = (video: HTMLVideoElement | undefined): VideoState => {
  const store = useMemo(() => (video === undefined ? idleStore : createVideoStore(video)), [video])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

// ── Fullscreen ───────────────────────────────────────────────────────────────

const subscribeFullscreen = (notify: () => void) => {
  document.addEventListener('fullscreenchange', notify)
  document.addEventListener('webkitfullscreenchange', notify)
  return () => {
    document.removeEventListener('fullscreenchange', notify)
    document.removeEventListener('webkitfullscreenchange', notify)
  }
}

const fullscreenElement = (): Element | undefined =>
  document.fullscreenElement ??
  (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement ??
  undefined

export const useIsFullscreen = (): boolean =>
  useSyncExternalStore(subscribeFullscreen, () => fullscreenElement() !== undefined)

/** Container fullscreen where supported, the video's own on iOS Safari. */
export const toggleFullscreen = (container: HTMLElement, video: HTMLVideoElement): void => {
  if (fullscreenElement() !== undefined) {
    void document.exitFullscreen().catch(() => undefined)
    return
  }
  if (typeof container.requestFullscreen === 'function') {
    void container.requestFullscreen().catch(() => undefined)
    return
  }
  const webkitVideo = video as unknown as { webkitEnterFullscreen?: () => void }
  webkitVideo.webkitEnterFullscreen?.()
}

// ── Volume memory (§10.7: per device) ────────────────────────────────────────

const volumeKey = 'projo.player.volume'

export const loadVolume = (): { volume: number; muted: boolean } => {
  try {
    const parsed = JSON.parse(localStorage.getItem(volumeKey) ?? '{}') as {
      volume?: unknown
      muted?: unknown
    }
    return {
      volume:
        typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1
          ? parsed.volume
          : 1,
      muted: parsed.muted === true,
    }
  } catch {
    return { volume: 1, muted: false }
  }
}

export const saveVolume = (volume: number, muted: boolean): void => {
  try {
    localStorage.setItem(volumeKey, JSON.stringify({ volume, muted }))
  } catch {
    // Storage disabled (private mode): the volume is just not remembered.
  }
}

// ── Commands (kept outside components: React Compiler forbids mutating hook values) ──

export const togglePlayback = (video: HTMLVideoElement): void => {
  if (video.paused || video.ended) video.play().catch(() => undefined)
  else video.pause()
}

export const seekTo = (video: HTMLVideoElement, seconds: number): void => {
  const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
  video.currentTime = Math.min(Math.max(0, seconds), duration)
}

export const setVolumeLevel = (video: HTMLVideoElement, volume: number): void => {
  video.volume = Math.min(1, Math.max(0, volume))
  video.muted = video.volume === 0
}

export const toggleMuted = (video: HTMLVideoElement): void => {
  video.muted = !video.muted
  if (!video.muted && video.volume === 0) video.volume = 0.5
}

export const restoreVolume = (video: HTMLVideoElement): void => {
  const saved = loadVolume()
  video.volume = saved.volume
  video.muted = saved.muted
}

export const setPlaybackRate = (video: HTMLVideoElement, rate: number): void => {
  video.defaultPlaybackRate = rate
  video.playbackRate = rate
}

/** iOS ignores `video.volume` (hardware buttons only): the volume UI is pointless there. */
export const volumeSettable = (video: HTMLVideoElement): boolean => {
  const before = video.volume
  const probe = before === 0.5 ? 0.6 : 0.5
  video.volume = probe
  const settable = Math.abs(video.volume - probe) < 0.01
  video.volume = before
  return settable
}

// ── Picture-in-Picture (standard, and WebKit's presentation mode) ────────────

type WebkitPresentation = {
  webkitSupportsPresentationMode?: (mode: string) => boolean
  webkitSetPresentationMode?: (mode: string) => void
  webkitPresentationMode?: string
}

const webkit = (video: HTMLVideoElement) => video as unknown as WebkitPresentation

export const pictureInPictureSupported = (video: HTMLVideoElement | undefined): boolean => {
  if (video === undefined) return false
  if (typeof document !== 'undefined' && document.pictureInPictureEnabled === true) return true
  return webkit(video).webkitSupportsPresentationMode?.('picture-in-picture') === true
}

const inPictureInPicture = (video: HTMLVideoElement) =>
  document.pictureInPictureElement === video ||
  webkit(video).webkitPresentationMode === 'picture-in-picture'

export const togglePictureInPicture = (video: HTMLVideoElement): void => {
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

const pipEvents = [
  'enterpictureinpicture',
  'leavepictureinpicture',
  'webkitpresentationmodechanged',
]

export const usePictureInPicture = (video: HTMLVideoElement | undefined): boolean => {
  const store = useMemo(
    () => ({
      subscribe: (notify: () => void) => {
        if (video === undefined) return () => {}
        for (const type of pipEvents) video.addEventListener(type, notify)
        return () => {
          for (const type of pipEvents) video.removeEventListener(type, notify)
        }
      },
      getSnapshot: () => video !== undefined && inPictureInPicture(video),
    }),
    [video],
  )
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
