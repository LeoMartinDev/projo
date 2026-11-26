import {
  type CatalogItemKind,
  catalogItemKindSchema,
  type CatalogItemsSort,
  catalogItemsSortSchema,
} from '@projo/shared/api/metadata'

/** The filters of Media › Catalogue, kept in the address (§15): defaults are left out. */
export type CatalogueSearch = {
  q?: string
  kind?: CatalogItemKind
  library?: string
  sort?: Exclude<CatalogItemsSort, 'title'>
}

export const searchMinLength = 2

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

export const parseCatalogueSearch = (search: Record<string, unknown>): CatalogueSearch => {
  const q = text(search['q'])
  const kind = catalogItemKindSchema.safeParse(search['kind'])
  const library = text(search['library'])
  const sort = catalogItemsSortSchema.safeParse(search['sort'])
  return {
    ...(q === undefined ? {} : { q }),
    ...(kind.success ? { kind: kind.data } : {}),
    ...(library === undefined ? {} : { library }),
    ...(sort.success && sort.data !== 'title' ? { sort: sort.data } : {}),
  }
}

/** The query of `GET /admin/items`: a text too short to search is not sent. */
export const catalogueQuery = (search: CatalogueSearch): Record<string, string> => {
  const q = search.q?.trim() ?? ''
  return {
    ...(q.length < searchMinLength ? {} : { q }),
    ...(search.kind === undefined ? {} : { kind: search.kind }),
    ...(search.library === undefined ? {} : { libraryId: search.library }),
    ...(search.sort === undefined ? {} : { sort: search.sort }),
  }
}
