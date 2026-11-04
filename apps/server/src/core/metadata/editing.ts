import type { AppError, Result } from '@projo/shared'
import type { GenreId } from '@projo/shared/api/genres'
import type { EditableField, EditableImageKind } from '@projo/shared/api/metadata'

import type { LeavingFiles } from '../library/library.ts'
import type { LockableField } from './enrichment.ts'
import type { LinkedItemInfo } from './linking.ts'
import type { ItemKind } from './ports.ts'

export type { EditableField, EditableImageKind }

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

export type ItemOverrides = {
  title?: string
  year?: number
  overview?: string
  genres?: GenreId[]
  posterImageId?: string
  backdropImageId?: string
}

export type EditableItem = {
  id: string
  kind: ItemKind
  tmdbId?: number
  title?: string
  year?: number
  overview?: string
  genres: GenreId[]
  posterImageId?: string
  backdropImageId?: string
  metadataRefreshedAt?: Date
}

export type RestoredValues = Pick<ItemOverrides, 'title' | 'year' | 'overview' | 'genres'>

export type ItemOverrideRepository = {
  item: (itemId: string) => EditableItem | undefined
  get: (itemId: string) => ItemOverrides
  set: (input: { itemId: string; overrides: ItemOverrides; at: Date }) => void
  remove: (input: {
    itemId: string
    field: LockableField
    restored?: { [K in keyof RestoredValues]?: RestoredValues[K] | undefined }
    at: Date
  }) => void
}

export type MetadataRefreshRepository = {
  children: (itemId: string) => LinkedItemInfo[]
  libraryOf: (itemId: string) => { ratingCountry: string; language?: string } | undefined
  staleLanguage: (input: { serverLanguage: string; libraryId?: string }) => string[]
  decidedBy: (libraryId: string) => string[]
  treeStates: (input: {
    topIds: readonly string[]
    serverLanguage: string
  }) => { topId: string; ratingCountry: string; stale: boolean }[]
  topLevelWithFiles: (files: LeavingFiles) => string[]
  identifiedTopLevel: (libraryId: string) => string[]
  inProductionSeriesRefreshedBefore: (before: Date) => string[]
}

export type ImageAlternative = {
  tmdbPath: string
  width: number
  height: number
  language?: string
  voteAverage?: number
}

export type UploadedImageType = 'jpeg' | 'png' | 'webp'

export type ImageUploadError = AppError<
  'image/unsupported_type' | 'image/too_large' | 'image/unreadable'
>

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

export type RefreshMetadataPayload = { itemId: string } | { libraryId: string }
