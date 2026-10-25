export const dbErrorCodes = [
  'db/open_failed',
  'db/migration_failed',
  'db/backup_failed',
  'db/constraint_violation',
  /** "Exporter la base": the `VACUUM INTO` in `db/backups/` failed (§5.4, §15 "Server"). */
  'db/export_failed',
] as const

export type DbErrorCode = (typeof dbErrorCodes)[number]
