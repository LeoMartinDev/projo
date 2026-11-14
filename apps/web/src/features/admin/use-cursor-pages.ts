import { useState } from 'react'

import {
  currentCursor,
  firstPage,
  nextPage,
  pageNumber,
  pagesFor,
  previousPage,
} from './cursor-pages.ts'

/** The shown page of a cursor-paginated table; `key` names its filters (others: first page). */
export const useCursorPages = (key: string) => {
  const [stored, setStored] = useState(() => firstPage(key))
  const pages = pagesFor(stored, key)
  const cursor = currentCursor(pages)
  return {
    cursor,
    page: pageNumber(pages),
    /** Changes with the filters and the page: the table scrolls back to its top. */
    view: `${key}\n${cursor}`,
    next: (nextCursor: string) => setStored(nextPage(pages, nextCursor)),
    previous: () => setStored(previousPage(pages)),
    first: () => setStored(firstPage(key)),
  }
}

export type CursorPagesState = ReturnType<typeof useCursorPages>
