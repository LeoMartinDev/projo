import type { AppError, Result } from '@projo/shared'
import type { ReviewReason } from '@projo/shared/api/metadata'

import type { ImageSlot, LockableField, MetadataPatch, PersonCredit } from './enrichment.ts'
import type { LinkedItemInfo } from './linking.ts'

export type ItemKind = 'movie' | 'series' | 'season' | 'episode'

export type NewMetadataItem = {
  id: string
  kind: ItemKind
  parentId?: string
  tmdbId?: number
  title?: string
  sortTitle: string
  seasonNumber?: number
  episodeNumber?: number
  createdAt: Date
}

export type ItemImageContext = {
  id: string
  kind: ItemKind
  tmdbId?: number
  seasonNumber?: number
  episodeNumber?: number
  seriesTmdbId?: number
  libraryLanguage?: string
}

export type ItemImageRef = { imageId: string; tmdbPath?: string; origin: 'tmdb' | 'custom' }

export type StoredImage = {
  id: string
  kind: ImageSlot | 'profile'
  origin: 'tmdb' | 'custom'
  tmdbPath?: string
  localPath: string
  width: number
  height: number
  language?: string
}

export type ItemPersonImage = { personId: string; tmdbId: number; profileImageId?: string }

export type MetadataItemRepository = {
  /** Events published inside are delivered once it commits, never if it rolls back. */
  transaction: <T>(run: () => T) => T
  findItem: (id: string) => LinkedItemInfo | undefined
  linkedItems: (sourceId: string) => LinkedItemInfo[]
  findByTmdb: (input: { kind: 'movie' | 'series'; tmdbId: number }) => string | undefined
  findChild: (input: {
    parentId: string
    kind: 'season' | 'episode'
    number: number
  }) => string | undefined
  create: (item: NewMetadataItem) => void
  setTmdbId: (input: { id: string; tmdbId: number }) => void
  lockedFields: (itemId: string) => Set<LockableField>
  writeMetadata: (input: {
    id: string
    patch: MetadataPatch
    language: string
    refreshedAt: Date
  }) => void
  replacePeople: (input: { itemId: string; people: PersonCredit[]; newId: () => string }) => void
  moveItemRows: (input: { from: string; into: string }) => void
  replaceLinks: (input: { sourceId: string; itemIds: string[] }) => void
  markAdded: (input: { itemIds: string[]; at: Date }) => void
  pruneOrphans: (itemIds: string[], beforeDelete: (itemIds: string[]) => void) => void
  sourcesUnder: (
    itemId: string,
  ) => { sourceId: string; seasonNumber?: number; episodeNumber?: number }[]
  sourcesAwaitingMatch: (input: {
    libraryId?: string
    reviewReasons: readonly ReviewReason[]
  }) => string[]
  imageContext: (itemId: string) => ItemImageContext | undefined
  peopleOf: (itemId: string) => ItemPersonImage[]
}

export type ImageRepository = {
  findById: (id: string) => StoredImage | undefined
  itemImage: (input: { itemId: string; slot: ImageSlot }) => ItemImageRef | undefined
  insert: (image: StoredImage) => void
  setItemImage: (input: { itemId: string; slot: ImageSlot; imageId: string }) => void
  setPersonImage: (input: { personId: string; imageId: string }) => void
  localPaths: () => string[]
  deleteIfUnused: (id: string) => StoredImage | undefined
  listUnused: () => string[]
}

export type ImageFilesError = AppError<'metadata/image_failed'>

export type ImageFiles = {
  write: (input: {
    relativePath: string
    bytes: Uint8Array
  }) => Promise<Result<void, ImageFilesError>>
  remove: (relativePath: string) => Promise<void>
  absolutePath: (relativePath: string) => string
}

export type ManualMatchKey = {
  libraryId: string
  relativePath: string
  signature?: string
}

export type ManualMatch = ManualMatchKey & {
  sourceId?: string
  tmdbId: number
  kind: 'movie' | 'episode'
  seasonNumber?: number
  episodeNumber?: number
  createdBy: string
  createdAt: Date
}

export type ManualMatchRepository = {
  findFor: (source: {
    id: string
    libraryId: string
    relativePath: string
    signature?: string
  }) => ManualMatch | undefined
  save: (match: ManualMatch) => void
}

export type MetadataSettings = {
  tmdbApiKey: () => string | undefined
  language: () => string
  setTmdbApiKey: (input: { key: string | undefined; at: Date }) => void
  tmdbApiKeyRejectedAt: () => Date | undefined
  markTmdbApiKeyRejected: (at: Date) => void
  setLanguage: (input: { language: string; at: Date }) => void
}

export type TmdbResponseStore = {
  get: (key: string) => { payload: unknown; fetchedAt: Date } | undefined
  put: (input: { key: string; payload: unknown; fetchedAt: Date }) => void
}

export type TmdbResponsePurge = {
  purgeFetchedBefore: (before: Date) => number
}

export type MatchRequester = (input: { sourceId: string }) => void
