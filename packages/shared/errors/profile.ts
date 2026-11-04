export const profileErrorCodes = [
  'profile/not_found',
  'profile/required',
  'profile/forbidden',
  'profile/limit_reached',
  'profile/pin_required',
  'profile/invalid_pin',
  'profile/rate_limited',
  'profile/last_profile',
  'profile/last_unrestricted',
  'profile/unknown_library',
  'profile/admin_only',
  'profile/restricted',
] as const

export type ProfileErrorCode = (typeof profileErrorCodes)[number]
