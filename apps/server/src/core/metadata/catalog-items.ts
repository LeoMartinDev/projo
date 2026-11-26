import type { CatalogPosition, ItemKind, SortOrder } from '../catalog/catalog.ts'
import type { EditableField } from './editing.ts'

/** Media › Catalogue (§15): the movies and shows an admin finds and corrects. */
export type CatalogItemKind = 'movie' | 'series'
export type CatalogItemsSort = 'title' | 'added' | 'year'

/** Files linked to a title: `ready` ones play, `missing` ones are gone from the disk (§7.5). */
export type FileCounts = { ready: number; missing: number }

export type CatalogItemRow = {
  id: string
  kind: CatalogItemKind
  title: string
  sortTitle: string
  year?: number
  posterImageId?: string
  tmdbId?: number
  /** The libraries holding a file of the title (of an episode, for a show), by name. */
  libraries: { id: string; name: string }[]
  files: FileCounts
  seasons?: number
  episodes?: number
  episodeCountTmdb?: number
  locked: EditableField[]
  addedAt?: Date
  createdAt: Date
}

export type CatalogItemsFilter = {
  kind?: CatalogItemKind
  /** An FTS5 expression (`toSearchExpression`) on the title and the original title. */
  search?: string
  libraryId?: string
}

export type CatalogEpisodeRow = {
  id: string
  episodeNumber?: number
  title?: string
  airDate?: string
  stillImageId?: string
  files: FileCounts
  locked: EditableField[]
}

export type CatalogSeasonRow = {
  id: string
  seasonNumber?: number
  title?: string
  locked: EditableField[]
  episodes: CatalogEpisodeRow[]
}

export type CatalogItems = {
  list: (
    input: CatalogItemsFilter & {
      sort: CatalogItemsSort
      order: SortOrder
      after?: CatalogPosition
      limit: number
    },
  ) => CatalogItemRow[]
  kindOf: (itemId: string) => ItemKind | undefined
  /** A show's seasons, by number, each with its episodes by number. */
  seasons: (seriesId: string) => CatalogSeasonRow[]
}
