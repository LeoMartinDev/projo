import type { JobErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const jobErrorStatus = {
  'job/not_found': 404,
  'job/invalid_payload': 500,
  'job/handler_crashed': 500,
  'job/cancelled': 409,
  'job/not_cancellable': 409,
  'job/not_retryable': 409,
  'job/failed': 500,
} satisfies ErrorStatusMap<JobErrorCode>
