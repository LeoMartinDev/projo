import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogItems, CatalogSeasonRow } from '../../core/metadata/catalog-items.ts'
import { itemNotFound } from './shared/item-errors.ts'

export type ListSeriesSeasonsError = AppError<'item/not_found' | 'item/invalid_kind'>

/** A show's page in Media › Catalogue (§15): its seasons and their episodes. */
export const listSeriesSeasonsFactory =
  ({ catalogItems }: { catalogItems: Pick<CatalogItems, 'kindOf' | 'seasons'> }) =>
  ({ itemId }: { itemId: string }): Result<CatalogSeasonRow[], ListSeriesSeasonsError> => {
    const kind = catalogItems.kindOf(itemId)
    if (kind === undefined) return itemNotFound(itemId)
    if (kind !== 'series') {
      return err(
        appError('item/invalid_kind', 'only a show has seasons', { context: { id: itemId, kind } }),
      )
    }
    return ok(catalogItems.seasons(itemId))
  }

export type ListSeriesSeasons = ReturnType<typeof listSeriesSeasonsFactory>
