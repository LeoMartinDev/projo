import type { SegmentErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const segmentErrorStatus = {
  'segment/invalid_range': 422,
  'segment/not_an_episode': 422,
  'segment/not_found': 404,
  'segment/provider_unavailable': 502,
  'segment/provider_invalid_response': 502,
  'segment/provider_rate_limited': 503,
  'segment/theintrodb_key_invalid': 422,
  'segment/contribution_requires_key': 422,
  'segment/submission_failed': 502,
  'segment/fingerprint_failed': 500,
} satisfies ErrorStatusMap<SegmentErrorCode>
