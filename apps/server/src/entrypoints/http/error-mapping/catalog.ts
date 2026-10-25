import type { CatalogErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const catalogErrorStatus = {
  'catalog/invalid_cursor': 400,
  'catalog/image_not_found': 404,
} satisfies ErrorStatusMap<CatalogErrorCode>
