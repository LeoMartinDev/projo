import type { HlsConfig } from 'hls.js'

import type { EngineStats, LivePoint, StreamFailure } from '@projo/player/core/engine'
import { waitForPlaylist } from '@projo/player/core/playlist-wait'

import { hlsFailureKind, mediaErrorKind } from './failure-kind.ts'
import { liveSyncS, livePointOf, mediaTimeAt, nativeMediaTimeAt } from './live-position.ts'
import { keyframeWaitLoadPolicy, mediaPlaylistUrl } from './playlist.ts'
import { watchSeekStalls } from './seek-stall.ts'

export const loadHls = () => import('hls.js').then((module) => module.default)

export type HlsLoader = typeof loadHls

export type HlsMode = 'native' | 'mse'

/**
 * hls.js on a live playlist (§29.5): playback starts and settles 6 s behind the live edge, like
 * the playlist's `EXT-X-START`. No maximum latency (it would pull any rewind in the replay
 * window back to the edge), no catch-up speed-up; `seekable` is the window.
 */
export const liveHlsConfig = {
  liveSyncDuration: liveSyncS,
  maxLiveSyncPlaybackRate: 1,
  liveDurationInfinity: false,
  backBufferLength: 60,
} satisfies Partial<HlsConfig>

// What hls.js knows of the stream (playback info): nothing for a direct file or native HLS.
// Live, its position on the wall clock and a move in the replay window (timeshift, §29.5).
export type AttachedStream = {
  detach: () => void
  stats: () => Pick<EngineStats, 'videoCodec' | 'audioCodec' | 'frameRate' | 'bandwidth'>
  livePosition: () => number | undefined
  seekLive: (point: LivePoint) => void
}

type StartDated = { getStartDate?: () => Date }

const seekableOf = (video: HTMLVideoElement): { start: number; end: number } | undefined => {
  const { seekable } = video
  return seekable.length === 0
    ? undefined
    : { start: seekable.start(0), end: seekable.end(seekable.length - 1) }
}

/** Native HLS (Safari): the stream's start date, when its playlist has program dates. */
const startDateOf = (video: HTMLVideoElement): number | undefined => {
  const time = (video as unknown as StartDated).getStartDate?.().getTime()
  return time === undefined || !Number.isFinite(time) ? undefined : time
}

/** Timeshift in native HLS (§29.5): through `getStartDate()` and `seekable`. */
const nativeLive = (video: HTMLVideoElement) => ({
  livePosition: () => {
    const start = startDateOf(video)
    return start === undefined || video.readyState < 1
      ? undefined
      : start + video.currentTime * 1000
  },
  seekLive: (point: LivePoint) => {
    const seekable = seekableOf(video)
    if (seekable === undefined) return
    const start = startDateOf(video)
    video.currentTime =
      point.live === true || start === undefined
        ? livePointOf(seekable.end)
        : nativeMediaTimeAt(start, point.atMs, seekable)
  },
})

const seekOnceLoaded = (video: HTMLVideoElement, seconds: number) => {
  if (seconds <= 0) return () => {}
  const seek = () => {
    video.currentTime = seconds
  }
  video.addEventListener('loadedmetadata', seek, { once: true })
  return () => video.removeEventListener('loadedmetadata', seek)
}

/**
 * Plays a stream in the `<video>`: a direct file or native HLS through `src`
 * (native HLS waits for the keyframe index first, §10.3), else hls.js over
 * MediaSource with one recovery per kind of fatal error. Returns what detaches it and what
 * hls.js knows of the stream.
 */
export const attachStream = ({
  video,
  stream,
  hlsMode,
  startSeconds,
  autoplay,
  onFatal,
  onOpened = () => {},
  withCredentials = true,
  live = false,
  liveFrom,
  hls: hlsLoader = loadHls,
}: {
  video: HTMLVideoElement
  stream: { type: 'direct' | 'hls'; url: string }
  hlsMode: HlsMode
  startSeconds: number
  autoplay: boolean
  onFatal: (failure: StreamFailure) => void
  // The media element (or hls.js) has the stream: a direct URL set, a native HLS playlist ready
  // after the keyframe wait, hls.js's manifest parsed. Never after detach.
  onOpened?: () => void
  // hls.js sends the session cookie: only on the server's own page (CORS never allows credentials).
  withCredentials?: boolean
  // A live playlist (§29.5): played from its live edge, ready as soon as it is handed over.
  live?: boolean
  // A live load from a point of its replay window (timeshift, §29.5); its live point is the
  // live sync's own.
  liveFrom?: LivePoint | undefined
  // Where hls.js comes from (tests hand a scripted one).
  hls?: HlsLoader
}): AttachedStream => {
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
        kind: mediaErrorKind(video.error?.code),
      })
    video.addEventListener('error', failed)
    video.addEventListener('loadedmetadata', play, { once: true })
    if (stream.type === 'direct' || live) {
      video.src = stream.url
      onOpened()
    } else
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
        if (wait !== 'ready' || disposed) return
        video.src = stream.url
        onOpened()
      })
    const timeshift = nativeLive(video)
    // A live load from a point of the window (not its live point): there once loaded.
    const startAt = () => {
      if (liveFrom !== undefined && liveFrom.live !== true) timeshift.seekLive(liveFrom)
    }
    if (live) video.addEventListener('loadedmetadata', startAt, { once: true })
    return {
      detach: () => {
        if (disposed) return
        disposed = true
        cancelSeek()
        stopSeekWatch()
        video.removeEventListener('error', failed)
        video.removeEventListener('loadedmetadata', play)
        video.removeEventListener('loadedmetadata', startAt)
        video.removeAttribute('src')
        video.load()
      },
      stats: () => ({}),
      livePosition: () => (live && !disposed ? timeshift.livePosition() : undefined),
      seekLive: (point) => {
        if (live && !disposed) timeshift.seekLive(point)
      },
    }
  }

  let destroy = () => {}
  let hlsStats: AttachedStream['stats'] = () => ({})
  let hlsLive: Pick<AttachedStream, 'livePosition' | 'seekLive'> = {
    livePosition: () => undefined,
    seekLive: () => {},
  }
  void hlsLoader().then((Hls) => {
    if (disposed) return
    const config: Partial<HlsConfig> = {
      ...(live
        ? liveHlsConfig
        : { startPosition: startSeconds, playlistLoadPolicy: keyframeWaitLoadPolicy }),
      maxBufferLength: 30,
      xhrSetup: (xhr) => {
        xhr.withCredentials = withCredentials
      },
    }
    const hls = new Hls(config)
    let recoveredNetwork = false
    let recoveredMedia = false
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && !recoveredNetwork) {
        recoveredNetwork = true
        // Live: from the live edge again (-1), the segments it stopped at may be gone.
        hls.startLoad(live ? -1 : video.currentTime > 0 ? video.currentTime : startSeconds)
        return
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
        recoveredMedia = true
        hls.recoverMediaError()
        return
      }
      report({ message: data.details, kind: hlsFailureKind(data.type) })
    })
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (disposed) return
      onOpened()
      play()
    })
    if (live) {
      // Timeshift (§29.5): a point maps to its fragment by the fragments' program dates.
      const fragments = () =>
        (hls.levels[Math.max(0, hls.currentLevel)]?.details?.fragments ?? []).map((fragment) => ({
          start: fragment.start,
          duration: fragment.duration,
          dateMs: fragment.programDateTime ?? undefined,
        }))
      const seekLive = (point: LivePoint) => {
        const seekable = seekableOf(video)
        const target =
          point.live === true
            ? (hls.liveSyncPosition ??
              (seekable === undefined ? undefined : livePointOf(seekable.end)))
            : mediaTimeAt(fragments(), point.atMs)
        if (target !== undefined) video.currentTime = target
      }
      hlsLive = {
        livePosition: () => hls.playingDate?.getTime() ?? undefined,
        seekLive,
      }
      // A live load from a point of the window (not its live point): there once listed.
      if (liveFrom !== undefined && liveFrom.live !== true) {
        const from = liveFrom
        hls.once(Hls.Events.LEVEL_LOADED, () => {
          if (!disposed) seekLive(from)
        })
      }
    }
    hls.loadSource(stream.url)
    hls.attachMedia(video)
    destroy = () => hls.destroy()
    hlsStats = () => {
      const level = hls.levels[hls.currentLevel]
      const bandwidth = hls.bandwidthEstimate
      return {
        ...(level?.videoCodec === undefined ? {} : { videoCodec: level.videoCodec }),
        ...(level?.audioCodec === undefined ? {} : { audioCodec: level.audioCodec }),
        ...(level?.frameRate ? { frameRate: level.frameRate } : {}),
        ...(Number.isFinite(bandwidth) && bandwidth > 0
          ? { bandwidth: Math.round(bandwidth) }
          : {}),
      }
    }
  })
  return {
    detach: () => {
      if (disposed) return
      disposed = true
      stopSeekWatch()
      destroy()
      video.removeAttribute('src')
      video.load()
    },
    stats: () => hlsStats(),
    livePosition: () => (disposed ? undefined : hlsLive.livePosition()),
    seekLive: (point) => {
      if (!disposed) hlsLive.seekLive(point)
    },
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
