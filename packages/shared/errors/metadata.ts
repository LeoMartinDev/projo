export const metadataErrorCodes = [
  /** No TMDB key in the settings: matching does not run (§9.1). */
  'metadata/tmdb_key_missing',
  /** The key just entered was refused by TMDB. */
  'metadata/tmdb_key_invalid',
  /** TMDB refused the stored key (401) while matching. */
  'metadata/tmdb_unauthorized',
  /** Network error, timeout, 5xx or 429 beyond the retries. */
  'metadata/tmdb_unavailable',
  /** No such movie, series, season or episode on TMDB. */
  'metadata/tmdb_not_found',
  /** TMDB answered something that does not match the expected schema. */
  'metadata/tmdb_invalid_response',
  /** Assignment of a series without episode number, and the file name has none either. */
  'metadata/episode_number_required',
  /** The season or episode does not exist on TMDB. */
  'metadata/episode_not_found',
  /** An image file could not be written or downloaded. */
  'metadata/image_failed',
  /**
   * The item has no TMDB id (local item, never identified): no refresh and no TMDB image
   * alternatives (§9.3, §9.4).
   */
  'metadata/not_matched',
] as const

export type MetadataErrorCode = (typeof metadataErrorCodes)[number]
