export const mediaSessionSkipS = 10

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
