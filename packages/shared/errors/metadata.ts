export const metadataErrorCodes = [
  'metadata/tmdb_key_missing',
  'metadata/tmdb_key_invalid',
  'metadata/tmdb_unauthorized',
  'metadata/tmdb_unavailable',
  'metadata/tmdb_not_found',
  'metadata/tmdb_invalid_response',
  'metadata/episode_number_required',
  'metadata/episode_not_found',
  'metadata/image_failed',
  'metadata/not_matched',
] as const

export type MetadataErrorCode = (typeof metadataErrorCodes)[number]
