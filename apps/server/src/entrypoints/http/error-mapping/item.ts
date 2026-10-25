import type { ItemErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const itemErrorStatus = {
  'item/not_found': 404,
  'item/no_playable_source': 409,
  'item/invalid_kind': 400,
} satisfies ErrorStatusMap<ItemErrorCode>
