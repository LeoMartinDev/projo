export const profileErrorCodes = [
  'profile/not_found',
  'profile/required',
  'profile/forbidden',
  'profile/limit_reached',
  'profile/pin_required',
  'profile/invalid_pin',
  'profile/rate_limited',
  'profile/last_profile',
  /** An admin account keeps at least one unrestricted profile (§14). */
  'profile/last_unrestricted',
  'profile/unknown_library',
  'profile/admin_only',
  /**
   * An account action (devices, tokens, password, other profiles, PINs) from a restricted active
   * profile, or without a resolved one on an account that has restricted profiles (§14).
   */
  'profile/restricted',
] as const

export type ProfileErrorCode = (typeof profileErrorCodes)[number]
