import type { TvLogoType } from './logo.ts'

/** Largest programme image downloaded (§29.3). */
export const TV_PROGRAMME_IMAGE_MAX_BYTES = 2 * 1024 * 1024
/** A URL that failed is tried again after this long (§29.3). */
export const TV_PROGRAMME_IMAGE_RETRY_MS = 6 * 60 * 60_000
/** A stored image is fetched again after this long (§29.3). */
export const TV_PROGRAMME_IMAGE_REFRESH_MS = 7 * 24 * 60 * 60_000
/** Every 15 minutes, the images of what is on now and next (§29.3). */
export const TV_PROGRAMME_IMAGES_INTERVAL_MS = 15 * 60_000

/** `dedupe_key` of `fetch_tv_programme_images` (§18): one at a time. */
export const TV_PROGRAMME_IMAGES_DEDUPE_KEY = 'tv_programme_images'

/** An image to fetch: its URL's key (SHA-256), its URL and the source whose guide gave it. */
export type TvProgrammeImageWork = { key: string; url: string; sourceId: string }

export type TvProgrammeImageRepository = {
  /**
   * The distinct images of the programmes on now and next at `at` of enabled, present channels
   * that have none stored, whose last attempt failed before `retryFailedBefore`, or that were
   * fetched before `refetchBefore`.
   */
  work: (input: {
    at: Date
    retryFailedBefore: Date
    refetchBefore: Date
  }) => TvProgrammeImageWork[]
  /** Records an attempt: `path` on success, a failure (previous file kept) without. */
  record: (input: { key: string; at: Date; path?: string }) => void
  /** The stored file of an image, relative to the images directory. */
  pathOf: (key: string) => string | undefined
  /** Forgets the images no stored programme refers to; returns their files to delete. */
  purgeUnreferenced: () => string[]
}

export const tvProgrammeImagePathOf = (key: string, type: TvLogoType): string =>
  `tv/programmes/${key}.${type}`
