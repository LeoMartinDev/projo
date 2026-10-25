import type { AppError, Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'
import type { EditableField, EditableImageKind } from '@projo/shared/api/metadata'

import type { LeavingFiles } from '../library/library.ts'
import type { LockableField } from './enrichment.ts'
import type { LinkedItemInfo } from './linking.ts'
import type { ItemKind } from './ports.ts'

/** §9.3 editing and locking, §9.4 refresh. Types and ports. */

export type { EditableField, EditableImageKind }

/** API field → `item_overrides.field`. */
export const lockableFieldOf: Record<EditableField, LockableField> = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster: 'poster_image_id',
  backdrop: 'backdrop_image_id',
}

export const editableFieldOf: Record<LockableField, EditableField> = {
  title: 'title',
  year: 'year',
  overview: 'overview',
  genres: 'genres',
  poster_image_id: 'poster',
  backdrop_image_id: 'backdrop',
}

/** The values stored in `item_overrides.value` (JSON), one optional key per locked field. */
export type ItemOverrides = {
  title?: string
  year?: number
  overview?: string
  genres?: GenreId[]
  /** `images.id`. */
  posterImageId?: string
  backdropImageId?: string
}

/** The editable columns of an item as users see them (overrides applied). */
export type EditableItem = {
  id: string
  kind: ItemKind
  tmdbId?: number
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title?: string
  year?: number
  overview?: string
  genres: GenreId[]
  posterImageId?: string
  backdropImageId?: string
  metadataRefreshedAt?: Date
}

/** The text values "Back to the TMDB value" can write back at once. */
export type RestoredValues = Pick<ItemOverrides, 'title' | 'year' | 'overview' | 'genres'>

/**
 * `item_overrides` (§6.3): a row = a locked field. Synchronous (bun:sqlite). Writing an override
 * also writes the value on the `items` row (what users see), in the same transaction.
 */
export type ItemOverrideRepository = {
  item: (itemId: string) => EditableItem | undefined
  get: (itemId: string) => ItemOverrides
  /** Upserts each present key (row + `items` column). */
  set: (input: { itemId: string; overrides: ItemOverrides; at: Date }) => void
  /**
   * Removes the lock. `restored`: the TMDB value written back on the `items` row in the same
   * transaction (a key present with `undefined` clears the column); absent, the column keeps its
   * value until TMDB writes it again.
   */
  remove: (input: {
    itemId: string
    field: LockableField
    restored?: { [K in keyof RestoredValues]?: RestoredValues[K] | undefined }
    at: Date
  }) => void
}

/** What a refresh walks (§9.4). Synchronous (bun:sqlite). */
export type MetadataRefreshRepository = {
  /** Direct children (seasons of a series, episodes of a season). */
  children: (itemId: string) => LinkedItemInfo[]
  /**
   * Settings of the library deciding the item (§9.1): the oldest one (`created_at`, then id)
   * holding a file of its movie or series, episodes included; the same for the whole tree.
   */
  libraryOf: (itemId: string) => { ratingCountry: string; language?: string } | undefined
  /**
   * Identified movies and series with an identified item of their tree whose `metadata_language`
   * differs from what its deciding library resolves to (its language, else `serverLanguage`).
   * `libraryId`: only those with a file in that library.
   */
  staleLanguage: (input: { serverLanguage: string; libraryId?: string }) => string[]
  /** Identified movies and series whose deciding library is this one. */
  decidedBy: (libraryId: string) => string[]
  /**
   * Of these identified movies and series, those still holding a file: the rating country of
   * their deciding library and whether their tree is `stale`, an identified item of it having a
   * `metadata_language` other than the one the tree resolves to (the deciding library's, else
   * `serverLanguage`) or a `content_rating_country` other than the movie's or series' own.
   */
  treeStates: (input: {
    topIds: readonly string[]
    serverLanguage: string
  }) => { topId: string; ratingCountry: string; stale: boolean }[]
  /** Identified movies and series with one of these files (episodes included). */
  topLevelWithFiles: (files: LeavingFiles) => string[]
  /** Identified movies and series with a file in the library. */
  identifiedTopLevel: (libraryId: string) => string[]
  /** `series_status = in_production` series not refreshed since `before` (never: included). */
  inProductionSeriesRefreshedBefore: (before: Date) => string[]
}

/** One TMDB image offered for a slot (§9.3: TMDB `/images`). */
export type ImageAlternative = {
  tmdbPath: string
  width: number
  height: number
  language?: string
  voteAverage?: number
}

/** §9.3: uploads up to 10 MB (`maxImageUploadBytes` in `@projo/shared/api/metadata`). */
export type UploadedImageType = 'jpeg' | 'png' | 'webp'

export type ImageUploadError = AppError<
  'image/unsupported_type' | 'image/too_large' | 'image/unreadable'
>

/**
 * Re-encoding of an uploaded image by ffmpeg before it is stored (§20): strips metadata, bounds
 * the size (posters 1000 px wide, backdrops 1920 px). The type comes from the magic bytes, never
 * from the name or the declared MIME type.
 */
export type ImageReencoder = {
  reencode: (input: {
    bytes: Uint8Array
    type: UploadedImageType
    kind: EditableImageKind
  }) => Promise<
    Result<
      { bytes: Uint8Array; extension: 'jpg' | 'png' | 'webp'; width: number; height: number },
      ImageUploadError | AppError<'media/binary_missing' | 'media/timeout'>
    >
  >
}

/**
 * Payload of `refresh_metadata` (§18): one item (button "Refresh", weekly in-production series:
 * dedupe `refresh:<id>`), or a whole library (dedupe `library-refresh:<id>`), which queues one
 * low-priority job per identified movie or series: concurrency 1 runs them one at a time. Locked fields are never written (§9.3); a refresh never creates an
 * episode without a file nor deletes an item (§9.4).
 */
export type RefreshMetadataPayload = { itemId: string } | { libraryId: string }
