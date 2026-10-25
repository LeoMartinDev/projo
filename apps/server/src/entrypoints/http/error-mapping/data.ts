import type { DataErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const dataErrorStatus = {
  'data/layout_failed': 500,
} satisfies ErrorStatusMap<DataErrorCode>
