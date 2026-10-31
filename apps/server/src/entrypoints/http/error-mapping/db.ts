import type { DbErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const dbErrorStatus = {
  'db/open_failed': 500,
  'db/migration_failed': 500,
  'db/backup_failed': 500,
  'db/export_failed': 500,
} satisfies ErrorStatusMap<DbErrorCode>
