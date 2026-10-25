export const playbackErrorCodes = [
  'playback/session_not_found',
  'playback/session_expired',
  'playback/source_unavailable',
  'playback/mode_unsupported',
  'playback/keyframes_unavailable',
  'playback/segment_not_found',
  'playback/segment_timeout',
  'playback/range_not_satisfiable',
  'playback/stream_failed',
  'playback/subtitle_not_found',
  'playback/subtitle_unsupported',
  'playback/transcode_limit_reached',
  'playback/trickplay_not_found',
  'playback/preview_not_found',
] as const

export type PlaybackErrorCode = (typeof playbackErrorCodes)[number]
