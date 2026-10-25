import type { ScanErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const scanErrorStatus = {
  'scan/root_walk_failed': 500,
  'scan/source_stuck_pending': 500,
  'scan/run_not_found': 404,
  'scan/unsupported_layout': 422,
  'scan/interrupted': 500,
} satisfies ErrorStatusMap<ScanErrorCode>
