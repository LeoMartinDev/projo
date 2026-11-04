export const commonErrorCodes = [
  'common/internal',
  'common/validation_failed',
  'common/not_found',
  'common/method_not_allowed',
] as const

export type CommonErrorCode = (typeof commonErrorCodes)[number]
