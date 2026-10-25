import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { CatalogPosition, CatalogSort, SortOrder } from './catalog.ts'

/**
 * Opaque pagination cursor (§17.1): base64url of `sort:order:id:keys…` (see `decodeCursor`).
 */

const toBase64Url = (text: string): string => {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const fromBase64Url = (value: string): string | undefined => {
  // atob throws on these; reject them first.
  if (value.length === 0 || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined
  }
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

const isNumericSort = (sort: CatalogSort): boolean => sort === 'year' || sort === 'rating'

export const encodeCursor = ({
  sort,
  order,
  position,
}: {
  sort: CatalogSort
  order: SortOrder
  position: CatalogPosition
}): string => toBase64Url([sort, order, position.id, ...position.keys.map(String)].join(':'))

const numberPattern = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i

/** Rejects a malformed cursor, or one produced by another sort or order. */
export const decodeCursor = (
  cursor: string,
  expected: { sort: CatalogSort; order: SortOrder },
): Result<CatalogPosition, AppError<'catalog/invalid_cursor'>> => {
  const invalid = err(
    appError('catalog/invalid_cursor', 'invalid pagination cursor', {
      context: { sort: expected.sort, order: expected.order },
    }),
  )
  // Numeric sorts: `sort:order:id:number:title`; others: `sort:order:id:value`. The last key may
  // contain `:`, the others never do.
  const pattern = isNumericSort(expected.sort)
    ? /^(\w+):(\w+):([^:]+):([^:]+):(.*)$/s
    : /^(\w+):(\w+):([^:]+):(.*)$/s
  const match = pattern.exec(fromBase64Url(cursor) ?? '') ?? undefined
  if (match === undefined || match[1] !== expected.sort || match[2] !== expected.order) {
    return invalid
  }
  const id = match[3] ?? ''
  if (!isNumericSort(expected.sort)) return ok({ id, keys: [match[4] ?? ''] })
  const value = match[4] ?? ''
  if (!numberPattern.test(value)) return invalid
  return ok({ id, keys: [Number(value), match[5] ?? ''] })
}
