import { z } from 'zod'

import {
  type CatalogSort,
  catalogSortSchema,
  type WatchFilter,
  watchFilterSchema,
} from './catalog.ts'
import { type GenreId, genreIdSchema } from './genres.ts'

/**
 * Sort and filters of Movies / Shows (§13.4), as sent to `GET /movies|/series`; kept per profile
 * and per device by each client (the web's `localStorage`, the app's Keychain). Anything
 * unreadable falls back to the defaults.
 */
export type CatalogQueryState = {
  sort: CatalogSort
  genre?: GenreId
  decade?: number
  year?: number
  watch?: WatchFilter
}

/** The query string of `GET /movies|/series` for a state and a page (`cursor`, `''` first). */
export const catalogListParams = (state: CatalogQueryState, cursor: string, limit: number) => ({
  sort: state.sort,
  limit: String(limit),
  ...(state.genre === undefined ? {} : { genre: state.genre }),
  ...(state.year === undefined
    ? state.decade === undefined
      ? {}
      : { decade: String(state.decade) }
    : { year: String(state.year) }),
  ...(state.watch === undefined ? {} : { watch: state.watch }),
  ...(cursor === '' ? {} : { cursor }),
})

export const defaultCatalogState: CatalogQueryState = { sort: 'title' }

const storedSchema = z.object({
  sort: catalogSortSchema.catch('title'),
  /** A genre id (§9.1); a name saved before ids ("Drame") is dropped. */
  genre: genreIdSchema.optional().catch(undefined),
  decade: z
    .number()
    .int()
    .refine((value) => value % 10 === 0)
    .optional()
    .catch(undefined),
  year: z.number().int().min(1800).max(3000).optional().catch(undefined),
  watch: watchFilterSchema.optional().catch(undefined),
})

/** A state being edited: a filter set to `undefined` is removed. */
export type CatalogStateDraft = {
  [K in keyof CatalogQueryState]?: CatalogQueryState[K] | undefined
} & {
  sort: CatalogQueryState['sort']
}

/** Drops `undefined` keys (`exactOptionalPropertyTypes`) and a year outside its decade. */
export const normalizeCatalogState = (state: CatalogStateDraft): CatalogQueryState => {
  const decade =
    state.decade ?? (state.year === undefined ? undefined : Math.floor(state.year / 10) * 10)
  return {
    sort: state.sort,
    ...(state.genre === undefined ? {} : { genre: state.genre }),
    ...(decade === undefined ? {} : { decade }),
    ...(state.year === undefined ||
    decade === undefined ||
    Math.floor(state.year / 10) * 10 !== decade
      ? {}
      : { year: state.year }),
    ...(state.watch === undefined ? {} : { watch: state.watch }),
  }
}

export const parseCatalogState = (value: unknown): CatalogQueryState => {
  const parsed = storedSchema.safeParse(value)
  if (!parsed.success) return defaultCatalogState
  const { sort, genre, decade, year, watch } = parsed.data
  return normalizeCatalogState({
    sort,
    ...(genre === undefined ? {} : { genre }),
    ...(decade === undefined ? {} : { decade }),
    ...(year === undefined ? {} : { year }),
    ...(watch === undefined ? {} : { watch }),
  })
}

/** Where a client keeps the state of a page (`movies`, `series`) for a profile. */
export const catalogStateKey = (profileId: string, kind: 'movies' | 'series') =>
  `projo.catalog.${profileId}.${kind}`

/** Filters set (the sort is not a filter): the count on the mobile "Filtres" button. */
export const activeFilterCount = (state: CatalogQueryState): number =>
  [state.genre, state.decade, state.watch].filter((value) => value !== undefined).length

export const clearFilters = (state: CatalogQueryState): CatalogQueryState =>
  normalizeCatalogState({
    sort: state.sort,
  })

/** Oldest and newest year of what the profile can see (`GET /genres` → `years`). */
export type YearRange = { min: number; max: number }

/**
 * Decades offered by the year filter, newest first, within the catalogue's years; the selected
 * one stays offered even if nothing is left in it.
 */
export const decadesWithin = (range: YearRange | undefined, selected?: number): number[] => {
  const decades =
    range === undefined
      ? []
      : Array.from(
          { length: (Math.floor(range.max / 10) - Math.floor(range.min / 10)) * 1 + 1 },
          (_, index) => Math.floor(range.max / 10) * 10 - index * 10,
        )
  return selected === undefined || decades.includes(selected)
    ? decades
    : [...decades, selected].sort((a, b) => b - a)
}

/** Years of a decade, newest first, within the catalogue's years. */
export const yearsOf = (decade: number, range: YearRange | undefined): number[] =>
  Array.from({ length: 10 }, (_, index) => decade + 9 - index).filter(
    (year) => range === undefined || (year >= range.min && year <= range.max),
  )

/**
 * What "See all ›" of Recently added puts in the URL of Movies / Shows (§13.3): `sort=added`.
 * Anything else is dropped.
 */
export type CatalogSearch = { sort?: 'added' }

export const parseCatalogSearch = (search: Record<string, unknown>): CatalogSearch =>
  search['sort'] === 'added' ? { sort: 'added' } : {}

/** The state Movies / Shows opens with: the remembered one, its sort replaced by the link's. */
export const arrivalState = (
  stored: CatalogQueryState,
  search: CatalogSearch,
): CatalogQueryState => (search.sort === undefined ? stored : { ...stored, sort: search.sort })
