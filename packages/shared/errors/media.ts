export const mediaErrorCodes = [
  'media/ffprobe_failed',
  'media/ffmpeg_failed',
  'media/binary_missing',
  'media/invalid_probe_output',
  'media/timeout',
] as const

export type MediaErrorCode = (typeof mediaErrorCodes)[number]
