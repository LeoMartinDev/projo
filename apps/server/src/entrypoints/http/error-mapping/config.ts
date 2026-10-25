import type { ConfigErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const configErrorStatus = {
  'config/invalid': 500,
} satisfies ErrorStatusMap<ConfigErrorCode>
