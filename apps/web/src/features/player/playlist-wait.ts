/**
 * Safari's native HLS player (§10.3) reports a 503 `playback/keyframes_unavailable` at once, where
 * hls.js asks again for ~5 min (`manifestLoadPolicy`: 15 retries, 1 s then 2 s apart). Before
 * handing the stream to `<video>`, the media playlist is fetched with the same budget until the
 * server stops answering 503: the first play of a big file on a network share waits for its
 * keyframe index instead of failing. Any other answer (200, another error, no network) hands
 * over at once: the native player loads it and reports its own errors.
 */
export const KEYFRAME_WAIT_RETRIES = 15

export type PlaylistWait = 'ready' | 'cancelled'

export const waitForPlaylist = async ({
  status,
  delay,
  cancelled,
  retries = KEYFRAME_WAIT_RETRIES,
}: {
  /** HTTP status of one playlist request (0: no answer). */
  status: () => Promise<number>
  delay: (ms: number) => Promise<void>
  /** The stream was detached meanwhile (next episode, leaving). */
  cancelled: () => boolean
  retries?: number
}): Promise<PlaylistWait> => {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await status()
    if (cancelled()) return 'cancelled'
    if (answer !== 503 || attempt >= retries) return 'ready'
    await delay(Math.min(1000 * 2 ** attempt, 2000))
    if (cancelled()) return 'cancelled'
  }
}

/** The media playlist next to `master.m3u8` (the one that waits for the keyframe index). */
export const mediaPlaylistUrl = (streamUrl: string, base: string): string =>
  new URL('index.m3u8', new URL(streamUrl, base)).href
