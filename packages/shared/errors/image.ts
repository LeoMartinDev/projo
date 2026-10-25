export const imageErrorCodes = [
  /** An uploaded image that is not JPEG, PNG or WebP, by its magic bytes (§9.3, §20). */
  'image/unsupported_type',
  /** An uploaded image above 10 MB (§9.3). */
  'image/too_large',
  /** The right magic bytes, but ffmpeg cannot decode it for the re-encoding (§20). */
  'image/unreadable',
] as const

export type ImageErrorCode = (typeof imageErrorCodes)[number]
