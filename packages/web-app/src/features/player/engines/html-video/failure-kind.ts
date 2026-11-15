import type { StreamFailure } from '@projo/player/core/engine'

// `MediaError.code` (HTML): 1 aborted, 2 network, 3 decode, 4 source not supported.
const mediaErrorNetwork = 2
const mediaErrorDecode = 3
const mediaErrorSourceNotSupported = 4

/** What a fatal `<video>` error means to the player (direct file, native HLS). */
export const mediaErrorKind = (code: number | undefined): StreamFailure['kind'] => {
  if (code === mediaErrorNetwork) return 'network'
  if (code === mediaErrorDecode || code === mediaErrorSourceNotSupported) return 'decode'
  return 'other'
}

/**
 * What a fatal hls.js error means to the player, once its own recovery failed (`Hls.ErrorTypes`
 * values): a media error (incompatible codecs, a buffer the MediaSource refuses, a fragment it
 * cannot parse) or a mux error comes from the stream as sent, not from the network.
 */
export const hlsFailureKind = (type: string): StreamFailure['kind'] => {
  if (type === 'networkError') return 'network'
  if (type === 'mediaError' || type === 'muxError') return 'decode'
  return 'other'
}
