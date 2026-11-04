import { z } from 'zod'

import {
  type CatalogSort,
  catalogSortSchema,
  type WatchFilter,
  watchFilterSchema,
} from './catalog.ts'
import { type GenreId, genreIdSchema } from './genres.ts'

export type CatalogQueryState = {
  sort: CatalogSort
  genre?: GenreId
  decade?: number
  year?: number
  watch?: WatchFilter
}

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

export type CatalogStateDraft = {
  [K in keyof CatalogQueryState]?: CatalogQueryState[K] | undefined
} & {
  sort: CatalogQueryState['sort']
}

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

export const catalogStateKey = (profileId: string, kind: 'movies' | 'series') =>
  `projo.catalog.${profileId}.${kind}`

export const activeFilterCount = (state: CatalogQueryState): number =>
  [state.genre, state.decade, state.watch].filter((value) => value !== undefined).length

export const clearFilters = (state: CatalogQueryState): CatalogQueryState =>
  normalizeCatalogState({
    sort: state.sort,
  })

export type YearRange = { min: number; max: number }

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

export const yearsOf = (decade: number, range: YearRange | undefined): number[] =>
  Array.from({ length: 10 }, (_, index) => decade + 9 - index).filter(
    (year) => range === undefined || (year >= range.min && year <= range.max),
  )

export type CatalogSearch = { sort?: 'added' }

export const parseCatalogSearch = (search: Record<string, unknown>): CatalogSearch =>
  search['sort'] === 'added' ? { sort: 'added' } : {}

export const arrivalState = (
  stored: CatalogQueryState,
  search: CatalogSearch,
): CatalogQueryState => (search.sort === undefined ? stored : { ...stored, sort: search.sort })
