export const jobErrorCodes = [
  'job/not_found',
  'job/invalid_payload',
  'job/handler_missing',
  'job/handler_crashed',
  'job/cancelled',
  'job/not_cancellable',
  'job/not_retryable',
  /** Notification kind (§16): a job failed on its last attempt. */
  'job/failed',
] as const

export type JobErrorCode = (typeof jobErrorCodes)[number]
