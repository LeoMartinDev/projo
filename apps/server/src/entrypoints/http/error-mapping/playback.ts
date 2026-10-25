import type { PlaybackErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const playbackErrorStatus = {
  'playback/session_not_found': 404,
  'playback/session_expired': 410,
  'playback/source_unavailable': 409,
  'playback/mode_unsupported': 422,
  'playback/keyframes_unavailable': 503,
  'playback/segment_not_found': 404,
  'playback/segment_timeout': 503,
  'playback/range_not_satisfiable': 416,
  'playback/stream_failed': 500,
  'playback/subtitle_not_found': 404,
  'playback/subtitle_unsupported': 422,
  'playback/transcode_limit_reached': 503,
  'playback/trickplay_not_found': 404,
  'playback/preview_not_found': 404,
} satisfies ErrorStatusMap<PlaybackErrorCode>
