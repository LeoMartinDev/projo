export const authErrorCodes = [
  'auth/invalid_credentials',
  'auth/unauthenticated',
  'auth/forbidden',
  'auth/restricted_profile',
  'auth/session_expired',
  'auth/session_revoked',
  'auth/account_disabled',
  'auth/rate_limited',
  'auth/origin_mismatch',
  'auth/username_taken',
  'auth/invitation_invalid',
  'auth/invitation_expired',
  'auth/invitation_used',
  'auth/session_not_found',
  'auth/pairing_limit_reached',
  'auth/pairing_invalid',
  'auth/pairing_expired',
  'auth/pairing_used',
  'auth/assistant_token_not_found',
] as const

export type AuthErrorCode = (typeof authErrorCodes)[number]
