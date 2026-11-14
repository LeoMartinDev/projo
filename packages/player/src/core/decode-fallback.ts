import type { PlaybackQuality, PlaybackSessionDto } from '@projo/shared/api/playback'

import type { StreamFailure } from './engine.ts'

// Best first: every one of them transcodes the video on the server (§10.2).
const transcodedQualities = ['1080p', '720p', '480p'] as const

/**
 * The quality a session falls back to when the engine cannot decode what the server sent it as
 * is (§10.2, §10.7): the best quality below Original the session offers, once per source.
 * `undefined` keeps the failure: not a decoding failure, a session already transcoded, no
 * quality below Original, or a fallback already made for that source.
 */
export const decodeFallbackQuality = ({
  failure,
  session,
  fallenBack,
}: {
  failure: StreamFailure
  session: Pick<PlaybackSessionDto, 'mode' | 'sourceId' | 'availableQualities'>
  fallenBack: ReadonlySet<string>
}): PlaybackQuality | undefined => {
  if (failure.kind !== 'decode' || session.mode === 'hls_transcode') return undefined
  if (fallenBack.has(session.sourceId)) return undefined
  return transcodedQualities.find((quality) => session.availableQualities.includes(quality))
}
