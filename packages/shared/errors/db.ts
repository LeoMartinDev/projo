export const dbErrorCodes = [
  'db/open_failed',
  'db/migration_failed',
  'db/backup_failed',
  'db/export_failed',
] as const

export type DbErrorCode = (typeof dbErrorCodes)[number]
