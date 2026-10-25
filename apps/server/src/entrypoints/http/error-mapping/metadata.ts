import type { MetadataErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const metadataErrorStatus = {
  'metadata/tmdb_key_missing': 409,
  'metadata/tmdb_key_invalid': 422,
  'metadata/tmdb_unauthorized': 502,
  'metadata/tmdb_unavailable': 502,
  'metadata/tmdb_not_found': 404,
  'metadata/tmdb_invalid_response': 502,
  'metadata/episode_number_required': 422,
  'metadata/episode_not_found': 422,
  'metadata/image_failed': 502,
  'metadata/not_matched': 409,
} satisfies ErrorStatusMap<MetadataErrorCode>
