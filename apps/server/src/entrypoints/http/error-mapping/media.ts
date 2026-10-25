import type { MediaErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const mediaErrorStatus = {
  'media/ffprobe_failed': 500,
  'media/ffmpeg_failed': 500,
  'media/binary_missing': 500,
  'media/invalid_probe_output': 500,
  'media/timeout': 504,
} satisfies ErrorStatusMap<MediaErrorCode>
