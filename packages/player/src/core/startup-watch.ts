import type { PlaybackSessionDto } from '@projo/shared/api/playback'

import type { StreamFailure } from './engine.ts'
import type { MediaSnapshot } from './media-state.ts'

/**
 * How long a session whose video is not transcoded may take, once the engine opened its stream,
 * to show its first frame (§10.7).
 */
export const startupTimeoutMs = 15_000

/**
 * A session whose video reaches the engine as the file has it (`direct`, `hls_remux`): an engine
 * may refuse it without a word (Safari's native HLS dropping an HDR variant, §10.2), so its start
 * is watched. A transcode is always H.264 SDR.
 */
export const watchesStartup = (session: Pick<PlaybackSessionDto, 'mode'>): boolean =>
  session.mode !== 'hls_transcode'

/**
 * At the deadline, a session that never reached `playing` is stuck unless it waits for the user:
 * its metadata loaded and paused (a session started paused, an autoplay the browser refused, a
 * pause before the start). That one is watched again from its next `play`.
 */
export const startupStuck = (media: Pick<MediaSnapshot, 'ready' | 'paused'>): boolean =>
  !(media.ready && media.paused)

/** A stuck start is a decoding failure: the player may fall back to a transcode (§10.2). */
export const startupFailure: StreamFailure = {
  kind: 'decode',
  message: `no picture ${startupTimeoutMs / 1000} s after the stream was opened`,
}
