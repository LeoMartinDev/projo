export type SeekableMedia = Pick<
  HTMLVideoElement,
  'currentTime' | 'seeking' | 'buffered' | 'addEventListener' | 'removeEventListener'
>

export const SEEK_STALL_MS = 1000

const isBuffered = (ranges: TimeRanges, seconds: number) => {
  for (let index = 0; index < ranges.length; index += 1)
    if (ranges.start(index) <= seconds && seconds <= ranges.end(index)) return true
  return false
}

export const watchSeekStalls = (
  media: SeekableMedia,
  {
    delay,
  }: {
    delay: (callback: () => void, ms: number) => () => void
  },
): (() => void) => {
  let cancel = () => {}
  const settled = () => {
    cancel()
    cancel = () => {}
  }
  const seeking = () => {
    settled()
    cancel = delay(() => {
      cancel = () => {}
      const target = media.currentTime
      if (media.seeking && isBuffered(media.buffered, target)) media.currentTime = target
    }, SEEK_STALL_MS)
  }
  media.addEventListener('seeking', seeking)
  media.addEventListener('seeked', settled)
  return () => {
    settled()
    media.removeEventListener('seeking', seeking)
    media.removeEventListener('seeked', settled)
  }
}
