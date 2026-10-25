export const segmentErrorCodes = [
  /** `endMs <= startMs`, negative, or beyond the item duration. */
  'segment/invalid_range',
  /** "Apply to the whole season" on a movie, or on an episode without season. */
  'segment/not_an_episode',
  /** No segment of that type on the item (`DELETE`). */
  'segment/not_found',
  /** A provider could not be reached (network, 5xx, timeout): the lookup is retried in 7 days. */
  'segment/provider_unavailable',
  /** A provider answered something that does not match its documented schema. */
  'segment/provider_invalid_response',
  /** 429 from a provider (rate or daily usage limit). */
  'segment/provider_rate_limited',
  /** `PATCH /admin/settings`: TheIntroDB refused the key. */
  'segment/theintrodb_key_invalid',
  /** `segment_contribution = manual_only` without a TheIntroDB key. */
  'segment/contribution_requires_key',
  /** A provider refused a manual marker submission. */
  'segment/submission_failed',
  /** `fpcalc` (Chromaprint) or `ffmpeg` missing or failing. */
  'segment/fingerprint_failed',
] as const

export type SegmentErrorCode = (typeof segmentErrorCodes)[number]
