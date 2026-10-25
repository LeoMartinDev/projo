import type { ImageErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const imageErrorStatus = {
  'image/unsupported_type': 415,
  'image/too_large': 413,
  'image/unreadable': 422,
} satisfies ErrorStatusMap<ImageErrorCode>
