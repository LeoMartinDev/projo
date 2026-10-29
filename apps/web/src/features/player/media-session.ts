/**
 * Now Playing (lock screen, Control Center, headset keys) through the Media Session API: what the
 * player tells the system. Pure: the hook is in `use-media-session.ts`.
 */

/** Seconds a "back" or "forward" press of the system controls moves. */
export const mediaSessionSkipS = 10

/**
 * The episode line as the title and the series as the artist; a movie is its title alone. The
 * poster at the 500 px width the image route serves (`imageWidths`).
 */
export const nowPlayingOf = ({
  title,
  subtitle,
  posterUrl,
}: {
  title: string
  subtitle?: string | undefined
  posterUrl?: string | undefined
}): MediaMetadataInit => ({
  title: subtitle ?? title,
  ...(subtitle === undefined ? {} : { artist: title }),
  ...(posterUrl === undefined
    ? {}
    : { artwork: [{ src: `${posterUrl}?w=500`, sizes: '500x750' }] }),
})

/**
 * `setPositionState` of the stream, undefined before the duration is known (the API throws on a
 * duration that is not a positive finite number, or a position past it).
 */
export const positionStateOf = (
  duration: number,
  position: number,
  playbackRate: number,
): MediaPositionState | undefined =>
  Number.isFinite(duration) && duration > 0
    ? {
        duration,
        position: Math.min(Math.max(0, position), duration),
        playbackRate: playbackRate > 0 ? playbackRate : 1,
      }
    : undefined
