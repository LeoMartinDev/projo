import type { AuthErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const authErrorStatus = {
  'auth/invalid_credentials': 401,
  'auth/unauthenticated': 401,
  'auth/forbidden': 403,
  'auth/restricted_profile': 403,
  'auth/session_expired': 401,
  'auth/session_revoked': 401,
  'auth/account_disabled': 403,
  'auth/rate_limited': 429,
  'auth/origin_mismatch': 403,
  'auth/username_taken': 409,
  'auth/password_too_weak': 400,
  'auth/invitation_invalid': 404,
  'auth/invitation_expired': 410,
  'auth/invitation_used': 410,
  'auth/token_not_found': 404,
  'auth/session_not_found': 404,
  'auth/pairing_limit_reached': 409,
  'auth/pairing_invalid': 404,
  'auth/pairing_expired': 410,
  'auth/pairing_used': 410,
} satisfies ErrorStatusMap<AuthErrorCode>
