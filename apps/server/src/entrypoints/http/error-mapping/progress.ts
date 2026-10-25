import type { ProgressErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const progressErrorStatus = {
  'progress/invalid_position': 400,
  'progress/item_not_playable': 409,
} satisfies ErrorStatusMap<ProgressErrorCode>
