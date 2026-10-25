/** What the watchdog needs of `<video>`: its seek state and its events. */
export type SeekableMedia = Pick<
  HTMLVideoElement,
  'currentTime' | 'seeking' | 'buffered' | 'addEventListener' | 'removeEventListener'
>

/** A seek into buffered media that has not ended after this long is stuck. */
export const SEEK_STALL_MS = 1000

const isBuffered = (ranges: TimeRanges, seconds: number) => {
  for (let index = 0; index < ranges.length; index += 1)
    if (ranges.start(index) <= seconds && seconds <= ranges.end(index)) return true
  return false
}

/**
 * WebKit on Linux (GStreamer) may never end a seek made before the first frame: the resume of a
 * direct file on `loadedmetadata`, hls.js's start position, or its jump over the gap before the
 * first audio sample. The video stays `seeking`, its target buffered, `seeked` never comes;
 * seeking again to the same time ends it. Only a seek whose target is buffered is retried: one waiting for its data (a seek
 * into a transcode) is left alone. Returns the cleanup.
 */
export const watchSeekStalls = (
  media: SeekableMedia,
  {
    delay,
  }: {
    /** Runs `callback` after `ms`; returns its cancellation. */
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
