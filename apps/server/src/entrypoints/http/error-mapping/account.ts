import type { AccountErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const accountErrorStatus = {
  'account/not_found': 404,
  'account/last_admin': 409,
  'account/confirmation_mismatch': 400,
  'account/wrong_password': 403,
} satisfies ErrorStatusMap<AccountErrorCode>
