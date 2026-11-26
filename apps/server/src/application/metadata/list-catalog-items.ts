import { andThen, type AppError, ok, type Result } from '@projo/shared'

import { sortKeys, type SortOrder } from '../../core/catalog/catalog.ts'
import { decodeCursor, encodeCursor } from '../../core/catalog/cursor.ts'
import { toSearchExpression } from '../../core/catalog/search.ts'
import type {
  CatalogItemKind,
  CatalogItemRow,
  CatalogItems,
  CatalogItemsSort,
} from '../../core/metadata/catalog-items.ts'

export type CatalogItemsPage = { items: CatalogItemRow[]; nextCursor?: string }

export type ListCatalogItemsError = AppError<'catalog/invalid_cursor'>

const orderOf = (sort: CatalogItemsSort): SortOrder => (sort === 'title' ? 'asc' : 'desc')

/**
 * A page of Media › Catalogue (§15). The search filters, whatever the order: a text too short to
 * search (one character) filters nothing.
 */
export const listCatalogItemsFactory =
  ({ catalogItems }: { catalogItems: Pick<CatalogItems, 'list'> }) =>
  ({
    query,
    kind,
    libraryId,
    sort,
    cursor,
    limit,
  }: {
    query?: string
    kind?: CatalogItemKind
    libraryId?: string
    sort: CatalogItemsSort
    cursor?: string
    limit: number
  }): Result<CatalogItemsPage, ListCatalogItemsError> => {
    const order = orderOf(sort)
    const search = query === undefined ? undefined : toSearchExpression(query)
    return andThen(
      cursor === undefined ? ok(undefined) : decodeCursor(cursor, { sort, order }),
      (after) => {
        const rows = catalogItems.list({
          sort,
          order,
          limit: limit + 1,
          ...(kind === undefined ? {} : { kind }),
          ...(search === undefined ? {} : { search }),
          ...(libraryId === undefined ? {} : { libraryId }),
          ...(after === undefined ? {} : { after }),
        })
        const page = rows.slice(0, limit)
        const last = page.at(-1)
        return ok({
          items: page,
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

export type ListCatalogItems = ReturnType<typeof listCatalogItemsFactory>
