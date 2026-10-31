import type { CommonErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const commonErrorStatus = {
  'common/internal': 500,
  'common/validation_failed': 400,
  'common/not_found': 404,
} satisfies ErrorStatusMap<CommonErrorCode>
