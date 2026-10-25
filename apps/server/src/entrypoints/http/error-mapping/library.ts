import type { LibraryErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const libraryErrorStatus = {
  'library/not_found': 404,
  'library/name_taken': 409,
  'library/root_not_found': 422,
  'library/root_not_directory': 422,
  'library/root_unreadable': 422,
  'library/root_duplicate': 409,
  'library/root_overlaps': 409,
  'library/root_unreachable': 409,
  'library/scan_already_running': 409,
  'library/invalid_settings': 400,
} satisfies ErrorStatusMap<LibraryErrorCode>
