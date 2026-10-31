import type { SourceErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const sourceErrorStatus = {
  'source/not_found': 404,
  'source/file_missing': 410,
  'source/not_missing': 409,
  'source/not_rejected': 409,
} satisfies ErrorStatusMap<SourceErrorCode>
