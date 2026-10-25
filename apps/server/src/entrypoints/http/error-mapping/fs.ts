import type { FsErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const fsErrorStatus = {
  'fs/invalid_path': 400,
  'fs/path_not_found': 404,
  'fs/not_a_directory': 400,
  'fs/permission_denied': 403,
  'fs/io_error': 500,
} satisfies ErrorStatusMap<FsErrorCode>
