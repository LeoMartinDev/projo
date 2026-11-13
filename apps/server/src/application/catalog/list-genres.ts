import { type GenreId, genreIds } from '@projo/shared/api/genres'

import type { CatalogReadModel, VisibilityScope } from '../../core/catalog/catalog.ts'

export const listGenresFactory =
  ({
    catalogReadModel,
  }: {
    catalogReadModel: Pick<CatalogReadModel, 'listGenres' | 'yearRange'>
  }) =>
  ({
    kind,
    scope,
  }: {
    kind?: 'movie' | 'series'
    scope: VisibilityScope
  }): { genres: GenreId[]; years?: { min: number; max: number } } => {
    const present = new Set(
      catalogReadModel.listGenres({ ...(kind === undefined ? {} : { kind }), scope }),
    )
    const genres = genreIds.filter((genre) => present.has(genre))
    const years = catalogReadModel.yearRange({ ...(kind === undefined ? {} : { kind }), scope })
    return { genres, ...(years === undefined ? {} : { years }) }
  }

export type ListGenres = ReturnType<typeof listGenresFactory>
