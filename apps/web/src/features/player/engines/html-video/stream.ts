import type { HlsConfig } from 'hls.js'

import type { StreamFailure } from '@projo/player/core/engine'
import { waitForPlaylist } from '@projo/player/core/playlist-wait'

import { keyframeWaitLoadPolicy, mediaPlaylistUrl } from './playlist.ts'
import { watchSeekStalls } from './seek-stall.ts'

export const loadHls = () => import('hls.js').then((module) => module.default)

export type HlsMode = 'native' | 'mse'

const seekOnceLoaded = (video: HTMLVideoElement, seconds: number) => {
  if (seconds <= 0) return () => {}
  const seek = () => {
    video.currentTime = seconds
  }
  video.addEventListener('loadedmetadata', seek, { once: true })
  return () => video.removeEventListener('loadedmetadata', seek)
}

const mediaErrorNetwork = 2

/**
 * Plays a stream in the `<video>`: a direct file or native HLS through `src`
 * (native HLS waits for the keyframe index first, §10.3), else hls.js over
 * MediaSource with one recovery per kind of fatal error. Returns what detaches it.
 */
export const attachStream = ({
  video,
  stream,
  hlsMode,
  startSeconds,
  autoplay,
  onFatal,
}: {
  video: HTMLVideoElement
  stream: { type: 'direct' | 'hls'; url: string }
  hlsMode: HlsMode
  startSeconds: number
  autoplay: boolean
  onFatal: (failure: StreamFailure) => void
}): (() => void) => {
  let disposed = false
  const report = (failure: StreamFailure) => {
    if (!disposed) onFatal(failure)
  }
  const play = () => {
    if (autoplay) video.play().catch(() => undefined)
  }
  const stopSeekWatch = watchSeekStalls(video, {
    delay: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
  })

  if (stream.type === 'direct' || hlsMode === 'native') {
    const cancelSeek = seekOnceLoaded(video, startSeconds)
    const failed = () =>
      report({
        message: video.error?.message ?? 'media error',
        network: video.error?.code === mediaErrorNetwork,
      })
    video.addEventListener('error', failed)
    video.addEventListener('loadedmetadata', play, { once: true })
    if (stream.type === 'direct') video.src = stream.url
    else
      void waitForPlaylist({
        status: () =>
          fetch(mediaPlaylistUrl(stream.url, window.location.href), {
            credentials: 'same-origin',
          }).then(
            (response) => {
              void response.body?.cancel()
              return response.status
            },
            () => 0,
          ),
        delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        cancelled: () => disposed,
      }).then((wait) => {
        if (wait === 'ready') video.src = stream.url
      })
    return () => {
      if (disposed) return
      disposed = true
      cancelSeek()
      stopSeekWatch()
      video.removeEventListener('error', failed)
      video.removeEventListener('loadedmetadata', play)
      video.removeAttribute('src')
      video.load()
    }
  }

  let destroy = () => {}
  void loadHls().then((Hls) => {
    if (disposed) return
    const config: Partial<HlsConfig> = {
      startPosition: startSeconds,
      maxBufferLength: 30,
      playlistLoadPolicy: keyframeWaitLoadPolicy,
      xhrSetup: (xhr) => {
        xhr.withCredentials = true
      },
    }
    const hls = new Hls(config)
    let recoveredNetwork = false
    let recoveredMedia = false
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recoveredNetwork) {
        recoveredNetwork = true
        hls.startLoad(video.currentTime > 0 ? video.currentTime : startSeconds)
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
        recoveredMedia = true
        hls.recoverMediaError()
        return
      }
      report({ message: data.details, network: data.type === Hls.ErrorTypes.NETWORK_ERROR })
    })
    hls.on(Hls.Events.MANIFEST_PARSED, play)
    hls.loadSource(stream.url)
    hls.attachMedia(video)
    destroy = () => hls.destroy()
  })
  return () => {
    if (disposed) return
    disposed = true
    stopSeekWatch()
    destroy()
    video.removeAttribute('src')
    video.load()
  }
}

/**
 * Loads another URL of the same stream (another subtitle offset), back at the
 * same position and play state. A reload over a pending one keeps the first
 * position.
 */
export const createStreamReloader = (video: HTMLVideoElement) => {
  let pending: { at: number; playing: boolean; cancel: () => void } | undefined
  const cancel = () => {
    pending?.cancel()
    pending = undefined
  }
  return {
    cancel,
    reload: (url: string) => {
      const previous = pending
      previous?.cancel()
      const at = previous?.at ?? video.currentTime
      const playing = previous?.playing ?? !video.paused
      const restore = () => {
        pending = undefined
        video.currentTime = at
        if (playing) video.play().catch(() => undefined)
      }
      video.addEventListener('loadedmetadata', restore, { once: true })
      pending = {
        at,
        playing,
        cancel: () => video.removeEventListener('loadedmetadata', restore),
      }
      video.src = url
    },
  }
}
