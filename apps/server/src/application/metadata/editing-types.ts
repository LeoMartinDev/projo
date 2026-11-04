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

export type ItemMetadataView = {
  id: string
  kind: ItemKind
  tmdbId?: number
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
  get: (input: { itemId: string }) => Result<ItemMetadataView, NotFound>
  setOverrides: (input: {
    itemId: string
    overrides: TextOverrides
  }) => Result<ItemMetadataView, NotFound>
  removeOverride: (input: {
    itemId: string
    field: EditableField
  }) => Promise<Result<ItemMetadataView, NotFound>>
  alternatives: (input: {
    itemId: string
    kind: EditableImageKind
  }) => Promise<
    Result<
      (ImageAlternative & { current: boolean })[],
      NotFound | TmdbError | AppError<'metadata/not_matched'>
    >
  >
  setImage: (input: {
    itemId: string
    choice: ImageChoice
  }) => Promise<Result<ItemMetadataView, SetItemImageError>>
  requestRefresh: (input: { itemId: string }) => Result<Job, RefreshError>
  requestLibraryRefresh: (input: {
    libraryId: string
  }) => Result<Job, AppError<'library/not_found'>>
}
