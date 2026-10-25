import type { ProfileErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const profileErrorStatus = {
  'profile/not_found': 404,
  'profile/required': 400,
  'profile/forbidden': 403,
  'profile/limit_reached': 409,
  'profile/pin_required': 403,
  'profile/invalid_pin': 403,
  'profile/rate_limited': 429,
  'profile/last_profile': 409,
  'profile/unknown_library': 400,
  'profile/admin_only': 403,
  'profile/restricted': 403,
} satisfies ErrorStatusMap<ProfileErrorCode>
