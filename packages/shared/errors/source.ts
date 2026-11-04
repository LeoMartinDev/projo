export const sourceErrorCodes = [
  'source/not_found',
  'source/file_missing',
  'source/not_missing',
  'source/not_rejected',
] as const

export type SourceErrorCode = (typeof sourceErrorCodes)[number]
