import type { UpdateErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const updateErrorStatus = {
  'update/disabled': 409,
  'update/check_failed': 502,
  'update/invalid_release': 502,
  'update/runtime_too_old': 409,
  'update/download_failed': 502,
  'update/checksum_mismatch': 502,
  'update/install_failed': 500,
  'update/not_found': 404,
  'update/already_current': 409,
  'update/in_progress': 409,
} satisfies ErrorStatusMap<UpdateErrorCode>
