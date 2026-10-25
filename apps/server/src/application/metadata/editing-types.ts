import type { AppError, Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'

import type { Job } from '../../core/jobs/job.ts'
import type {
  EditableField,
  EditableImageKind,
  ImageAlternative,
  ImageUploadError,
} from '../../core/metadata/editing.ts'
import type { ItemKind } from '../../core/metadata/ports.ts'
import type { TmdbError } from '../../core/metadata/tmdb.ts'

/**
 * The use cases of metadata editing (§9.3) and refresh (§9.4), called by `admin-items` and
 * `admin-libraries` routes. Built by `entrypoints/modules/metadata.ts`.
 */

/** The item as the editor shows it (overrides applied). Images: `images.id`. */
export type ItemMetadataView = {
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
  locked: EditableField[]
  metadataRefreshedAt?: Date
}

type NotFound = AppError<'item/not_found'>

export type TextOverrides = { title?: string; year?: number; overview?: string; genres?: GenreId[] }

export type ImageChoice =
  | { kind: EditableImageKind; tmdbPath: string }
  | { kind: EditableImageKind; upload: { bytes: Uint8Array; sizeBytes: number } }

export type SetItemImageError =
  | NotFound
  | ImageUploadError
  | TmdbError
  | AppError<
      'metadata/not_matched' | 'metadata/image_failed' | 'media/binary_missing' | 'media/timeout'
    >

export type RefreshError = NotFound | AppError<'metadata/not_matched'>

export type MetadataEditing = {
  /** `GET /admin/items/:id` (any item, visible or not). */
  get: (input: { itemId: string }) => Result<ItemMetadataView, NotFound>
  /** `PATCH /admin/items/:id`. */
  setOverrides: (input: {
    itemId: string
    overrides: TextOverrides
  }) => Result<ItemMetadataView, NotFound>
  /** `DELETE /admin/items/:id/overrides/:field` ("Back to the TMDB value"). */
  removeOverride: (input: {
    itemId: string
    field: EditableField
  }) => Promise<Result<ItemMetadataView, NotFound>>
  /** `GET /admin/items/:id/images/alternatives?kind=`; `current` flags the image in use. */
  alternatives: (input: {
    itemId: string
    kind: EditableImageKind
  }) => Promise<
    Result<
      (ImageAlternative & { current: boolean })[],
      NotFound | TmdbError | AppError<'metadata/not_matched'>
    >
  >
  /** `POST /admin/items/:id/images` (TMDB alternative or upload); locks the slot. */
  setImage: (input: {
    itemId: string
    choice: ImageChoice
  }) => Promise<Result<ItemMetadataView, SetItemImageError>>
  /** `POST /admin/items/:id/refresh`: enqueues `refresh_metadata` `{ itemId }`. */
  requestRefresh: (input: { itemId: string }) => Result<Job, RefreshError>
  /** `POST /admin/libraries/:id/refresh-metadata`: one `refresh_metadata` `{ libraryId }`. */
  requestLibraryRefresh: (input: {
    libraryId: string
  }) => Result<Job, AppError<'library/not_found'>>
}
