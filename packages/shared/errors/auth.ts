export const authErrorCodes = [
  'auth/invalid_credentials',
  'auth/unauthenticated',
  'auth/forbidden',
  /** `/admin/*` without an active profile, or from one with library or rating restrictions (§14). */
  'auth/restricted_profile',
  'auth/session_expired',
  'auth/session_revoked',
  'auth/account_disabled',
  'auth/rate_limited',
  'auth/origin_mismatch',
  'auth/username_taken',
  'auth/password_too_weak',
  'auth/invitation_invalid',
  'auth/invitation_expired',
  'auth/invitation_used',
  'auth/token_not_found',
  'auth/session_not_found',
] as const

export type AuthErrorCode = (typeof authErrorCodes)[number]
