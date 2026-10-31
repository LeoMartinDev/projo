import type { SetupErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const setupErrorStatus = {
  'setup/already_completed': 409,
} satisfies ErrorStatusMap<SetupErrorCode>
