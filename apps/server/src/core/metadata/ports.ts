import type { AppError, Result } from '@projo/shared'
import type { ReviewReason } from '@projo/shared/api/metadata'

import type { ImageSlot, LockableField, MetadataPatch, PersonCredit } from './enrichment.ts'
import type { LinkedItemInfo } from './linking.ts'

/** Ports of the metadata domain (§9). Repositories are synchronous (bun:sqlite). */

export type ItemKind = 'movie' | 'series' | 'season' | 'episode'

export type NewMetadataItem = {
  id: string
  kind: ItemKind
  parentId?: string
  tmdbId?: number
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title?: string
  sortTitle: string
  seasonNumber?: number
  episodeNumber?: number
  createdAt: Date
}

/** Where an item's images and people come from (fetch_images). */
export type ItemImageContext = {
  id: string
  kind: ItemKind
  tmdbId?: number
  seasonNumber?: number
  episodeNumber?: number
  /** Series TMDB id of a season or an episode. */
  seriesTmdbId?: number
  /**
   * `libraries.metadata_language` of the library deciding the item (§9.1: the oldest one holding a
   * file of its movie or series); undefined: server setting.
   */
  libraryLanguage?: string
}

export type ItemImageRef = { imageId: string; tmdbPath?: string; origin: 'tmdb' | 'custom' }

export type StoredImage = {
  id: string
  kind: ImageSlot | 'profile'
  origin: 'tmdb' | 'custom'
  tmdbPath?: string
  /** Relative to the images directory (`posters/<id>.jpg`). */
  localPath: string
  width: number
  height: number
  language?: string
}

export type ItemPersonImage = { personId: string; tmdbId: number; profileImageId?: string }

export type MetadataItemRepository = {
  transaction: <T>(run: () => T) => T
  findItem: (id: string) => LinkedItemInfo | undefined
  /** Items a source is linked to (`source_items`). */
  linkedItems: (sourceId: string) => LinkedItemInfo[]
  /** Top-level TMDB item (movie or series) of this TMDB id. */
  findByTmdb: (input: { kind: 'movie' | 'series'; tmdbId: number }) => string | undefined
  findChild: (input: {
    parentId: string
    kind: 'season' | 'episode'
    number: number
  }) => string | undefined
  create: (item: NewMetadataItem) => void
  setTmdbId: (input: { id: string; tmdbId: number }) => void
  lockedFields: (itemId: string) => Set<LockableField>
  /**
   * Writes the patch (absent keys untouched; `title` also rewrites `sort_title`) and the language
   * TMDB answered in (`metadata_language`, §9.4: stale rows after a language change).
   */
  writeMetadata: (input: {
    id: string
    patch: MetadataPatch
    language: string
    refreshedAt: Date
  }) => void
  /** Replaces `item_people` of the item; `people` rows upserted by TMDB id. */
  replacePeople: (input: { itemId: string; people: PersonCredit[]; newId: () => string }) => void
  /**
   * Moves what belongs to `from` onto `into`: per-profile rows (progress merged by recency,
   * watched kept, play counts added; Ma liste; track preferences by recency), segments and
   * lookups when `into` has none, playback sessions, earliest `added_at`.
   */
  moveItemRows: (input: { from: string; into: string }) => void
  replaceLinks: (input: { sourceId: string; itemIds: string[] }) => void
  markAdded: (input: { itemIds: string[]; at: Date }) => void
  /** Same rule as the M1 local items: only local items without source nor child go. */
  pruneOrphans: (itemIds: string[], beforeDelete: (itemIds: string[]) => void) => void
  /** Sources linked to the item or, for a series / season, to its episodes. */
  sourcesUnder: (
    itemId: string,
  ) => { sourceId: string; seasonNumber?: number; episodeNumber?: number }[]
  /** Ready sources that still wait for an identification (key just set, full scan). */
  sourcesAwaitingMatch: (input: {
    libraryId?: string
    reviewReasons: readonly ReviewReason[]
  }) => string[]
  imageContext: (itemId: string) => ItemImageContext | undefined
  /** People of the item with their TMDB id and current photo. */
  peopleOf: (itemId: string) => ItemPersonImage[]
}

export type ImageRepository = {
  findById: (id: string) => StoredImage | undefined
  /** Image of an item slot. */
  itemImage: (input: { itemId: string; slot: ImageSlot }) => ItemImageRef | undefined
  insert: (image: StoredImage) => void
  setItemImage: (input: { itemId: string; slot: ImageSlot; imageId: string }) => void
  setPersonImage: (input: { personId: string; imageId: string }) => void
  /** Files of every stored image (`image_variants`). */
  localPaths: () => string[]
  /** Deletes the row when nothing references it any more; returns it so the file can go too. */
  deleteIfUnused: (id: string) => StoredImage | undefined
}

export type ImageFilesError = AppError<'metadata/image_failed'>

/** Image files under `/data/images` (§5.4). */
export type ImageFiles = {
  write: (input: {
    relativePath: string
    bytes: Uint8Array
  }) => Promise<Result<void, ImageFilesError>>
  remove: (relativePath: string) => Promise<void>
  absolutePath: (relativePath: string) => string
}

/** The file a correction is remembered for (§9.2): its library and path, then its bytes. */
export type ManualMatchKey = {
  libraryId: string
  relativePath: string
  signature?: string
}

export type ManualMatch = ManualMatchKey & {
  /** The source it was last applied to; gone when that source was purged. */
  sourceId?: string
  /** Movie id, or series id for an episode. */
  tmdbId: number
  kind: 'movie' | 'episode'
  seasonNumber?: number
  episodeNumber?: number
  createdBy: string
  createdAt: Date
}

/**
 * Corrections (`manual_matches`, §7.8): consulted before any automatic matching. Keyed by the file,
 * independent from the `sources` row: purging a missing source keeps its correction.
 */
export type ManualMatchRepository = {
  /**
   * The correction last applied to this source (a recognized move keeps the row), else the one of
   * the same relative path in the library, else of a file with the same signature.
   */
  findFor: (source: {
    id: string
    libraryId: string
    relativePath: string
    signature?: string
  }) => ManualMatch | undefined
  /** One correction per path: replaces the one of this path, and any other of this source. */
  save: (match: ManualMatch) => void
}

/** Server metadata settings (`settings` table). */
export type MetadataSettings = {
  tmdbApiKey: () => string | undefined
  /** Server metadata language (§9.1), `fr-FR` when never set. */
  language: () => string
  /** Also forgets that TMDB refused the previous key. */
  setTmdbApiKey: (input: { key: string | undefined; at: Date }) => void
  /** TMDB answered 401 to the stored key since it was set (§15 "key rejected"). */
  tmdbApiKeyRejectedAt: () => Date | undefined
  markTmdbApiKeyRejected: (at: Date) => void
  setLanguage: (input: { language: string; at: Date }) => void
}

/**
 * TMDB responses stored in the database (§9.2: series and seasons cached in the database).
 * Raw validated payloads; the TMDB adapter re-validates them when reading.
 */
export type TmdbResponseStore = {
  get: (key: string) => { payload: unknown; fetchedAt: Date } | undefined
  put: (input: { key: string; payload: unknown; fetchedAt: Date }) => void
}

/** Asks for the identification of a source (job `match_source`, §18). */
export type MatchRequester = (input: { sourceId: string }) => void
