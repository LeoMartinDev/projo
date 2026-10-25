import type { SourceErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const sourceErrorStatus = {
  'source/not_found': 404,
  'source/not_ready': 409,
  'source/file_missing': 410,
  'source/too_small': 422,
  'source/probe_failed': 422,
  'source/decode_failed': 422,
  'source/unsupported_extension': 422,
  'source/not_missing': 409,
  'source/not_rejected': 409,
} satisfies ErrorStatusMap<SourceErrorCode>
