export const updateErrorCodes = [
  'update/disabled',
  'update/check_failed',
  'update/invalid_release',
  'update/runtime_too_old',
  'update/download_failed',
  'update/checksum_mismatch',
  'update/install_failed',
  'update/not_found',
  'update/already_current',
  'update/in_progress',
] as const

export type UpdateErrorCode = (typeof updateErrorCodes)[number]
