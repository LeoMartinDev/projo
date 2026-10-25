export const commonErrorCodes = [
  'common/internal',
  'common/validation_failed',
  'common/not_found',
  'common/rate_limited',
] as const

export type CommonErrorCode = (typeof commonErrorCodes)[number]
