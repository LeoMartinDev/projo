import { isExpired, type PlaybackSession } from '../../../core/playback/session.ts'

/**
 * The playback sessions that take a slot of `max_concurrent_transcodes` (§10.3): those in
 * `hls_transcode`, sessions without heartbeat for 60 s left out.
 */
export const runningTranscodes = (
  sessions: readonly PlaybackSession[],
  now: Date,
): PlaybackSession[] =>
  sessions.filter((session) => session.mode === 'hls_transcode' && !isExpired(session, now))
