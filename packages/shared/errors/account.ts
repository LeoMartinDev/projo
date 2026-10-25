export const accountErrorCodes = [
  'account/not_found',
  'account/last_admin',
  'account/confirmation_mismatch',
  'account/wrong_password',
] as const

export type AccountErrorCode = (typeof accountErrorCodes)[number]
