import type { MediaSnapshot } from '@projo/player/core/media-state'

import type { NowPlaying, SystemMediaAction, SystemMediaPosition } from '../../../host.ts'

export const mediaSessionSkipS = 10

export const nowPlayingOf = ({
  title,
  subtitle,
  posterUrl,
  resolve = (path) => path,
}: {
  title: string
  subtitle?: string | undefined
  posterUrl?: string | undefined
  // The media URL of a server path (`mediaUrl`: the desktop app's origin and media key, §20).
  resolve?: (path: string) => string
}): Omit<NowPlaying, 'actions'> => ({
  title: subtitle ?? title,
  ...(subtitle === undefined ? {} : { subtitle: title }),
  ...(posterUrl === undefined ? {} : { artworkUrl: resolve(`${posterUrl}?w=500`) }),
})

/**
 * What the system's controls offer: play and pause, seeking unless live (§29.5), the next track
 * only with a next episode or channel.
 */
export const systemMediaActions = (
  hasNext: boolean,
  seekable = true,
): readonly SystemMediaAction[] => [
  'play',
  'pause',
  ...(seekable ? (['seekbackward', 'seekforward', 'seekto'] as const) : []),
  ...(hasNext ? (['nexttrack'] as const) : []),
]

export const positionStateOf = (
  duration: number,
  position: number,
  playbackRate: number,
): { duration: number; position: number; playbackRate: number } | undefined =>
  Number.isFinite(duration) && duration > 0
    ? {
        duration,
        position: Math.min(Math.max(0, position), duration),
        playbackRate: playbackRate > 0 ? playbackRate : 1,
      }
    : undefined

/** The position the system's timeline shows, once the duration is known. */
export const systemMediaPositionOf = (media: MediaSnapshot): SystemMediaPosition | undefined => {
  const state = positionStateOf(media.duration, media.currentTime, media.playbackRate)
  return state === undefined
    ? undefined
    : {
        playing: !media.paused && !media.ended,
        positionMs: state.position * 1000,
        durationMs: state.duration * 1000,
        rate: state.playbackRate,
      }
}

/** Live (§29.5): the play state only, on an empty timeline (no duration, no position). */
export const liveSystemMediaPositionOf = (media: MediaSnapshot): SystemMediaPosition => ({
  playing: !media.paused && !media.ended,
  positionMs: 0,
  durationMs: 0,
  rate: 1,
})
