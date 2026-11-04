export const imageErrorCodes = [
  'image/unsupported_type',
  'image/too_large',
  'image/unreadable',
] as const

export type ImageErrorCode = (typeof imageErrorCodes)[number]
