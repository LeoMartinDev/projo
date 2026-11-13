import { andThen, type AppError, ok, type Result } from '@projo/shared'
import { type GenreId, genreIds } from '@projo/shared/api/genres'

import {
  type CatalogFilters,
  type CatalogReadModel,
  type CatalogSort,
  type SortOrder,
  sortKeys,
  type VisibilityScope,
} from '../../core/catalog/catalog.ts'
import { decodeCursor, encodeCursor } from '../../core/catalog/cursor.ts'
import type { CatalogEntries, CatalogEntry } from './catalog-entries.ts'

export type { CatalogEntry } from './catalog-entries.ts'

export type CatalogPage = { entries: CatalogEntry[]; nextCursor?: string }

type Deps = {
  catalogRepository: Pick<CatalogReadModel, 'listTopLevel'>
  catalogEntries: CatalogEntries
}

export type ListCatalogError = AppError<'catalog/invalid_cursor'>

export const defaultOrder = (sort: CatalogSort): SortOrder => (sort === 'title' ? 'asc' : 'desc')

export const listCatalogFactory =
  ({ catalogRepository, catalogEntries }: Deps) =>
  async ({
    kind,
    sort,
    cursor,
    limit,
    filters = {},
    profileId,
    scope,
  }: {
    kind: 'movie' | 'series'
    sort: CatalogSort
    cursor?: string
    limit: number
    filters?: CatalogFilters
    profileId: string
    scope: VisibilityScope
  }): Promise<Result<CatalogPage, ListCatalogError>> => {
    const order = defaultOrder(sort)
    return andThen(
      cursor === undefined ? ok(undefined) : decodeCursor(cursor, { sort, order }),
      (after) => {
        const rows = catalogRepository.listTopLevel({
          kind,
          sort,
          order,
          limit: limit + 1,
          scope,
          filters,
          profileId,
          ...(after === undefined ? {} : { after }),
        })
        const page = rows.slice(0, limit)
        const last = page[page.length - 1]
        return ok({
          entries: catalogEntries({ profileId, items: page, scope }),
          ...(rows.length > limit && last !== undefined
            ? {
                nextCursor: encodeCursor({
                  sort,
                  order,
                  position: { keys: sortKeys(last, sort, order), id: last.id },
                }),
              }
            : {}),
        })
      },
    )
  }

export type ListCatalog = ReturnType<typeof listCatalogFactory>

export const listGenresFactory =
  ({
    catalogRepository,
  }: {
    catalogRepository: Pick<CatalogReadModel, 'listGenres' | 'yearRange'>
  }) =>
  ({
    kind,
    scope,
  }: {
    kind?: 'movie' | 'series'
    scope: VisibilityScope
  }): { genres: GenreId[]; years?: { min: number; max: number } } => {
    const present = new Set(
      catalogRepository.listGenres({ ...(kind === undefined ? {} : { kind }), scope }),
    )
    const genres = genreIds.filter((genre) => present.has(genre))
    const years = catalogRepository.yearRange({ ...(kind === undefined ? {} : { kind }), scope })
    return { genres, ...(years === undefined ? {} : { years }) }
  }

export type ListGenres = ReturnType<typeof listGenresFactory>
