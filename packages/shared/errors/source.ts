export const sourceErrorCodes = [
  'source/not_found',
  'source/not_ready',
  'source/file_missing',
  'source/too_small',
  'source/probe_failed',
  'source/decode_failed',
  'source/unsupported_extension',
  /** `DELETE /admin/sources/:id` purges a `missing` source only (§15 "Manquants"). */
  'source/not_missing',
] as const

export type SourceErrorCode = (typeof sourceErrorCodes)[number]
