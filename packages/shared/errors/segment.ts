export const segmentErrorCodes = [
  'segment/invalid_range',
  'segment/not_an_episode',
  'segment/not_found',
  'segment/provider_unavailable',
  'segment/provider_invalid_response',
  'segment/provider_rate_limited',
  'segment/theintrodb_key_invalid',
  'segment/contribution_requires_key',
  'segment/submission_failed',
  'segment/fingerprint_failed',
] as const

export type SegmentErrorCode = (typeof segmentErrorCodes)[number]
