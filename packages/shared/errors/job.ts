export const jobErrorCodes = [
  'job/not_found',
  'job/invalid_payload',
  'job/handler_crashed',
  'job/cancelled',
  'job/not_cancellable',
  'job/not_retryable',
  'job/failed',
] as const

export type JobErrorCode = (typeof jobErrorCodes)[number]
