import { useEffect, useMemo, useState } from 'react'

import {
  type CursorPages,
  currentCursor,
  firstPage,
  nextPage,
  pageNumber,
  pagesFor,
  previousPage,
  storedPages,
} from './cursor-pages.ts'

const historyKey = 'projoCursorPages'

// The current history entry carries the pages (beside the router's own state), so coming back
// to it (the browser's back, a back arrow) shows the page that was left.
const rememberedPages = (): CursorPages | undefined =>
  storedPages(Reflect.get(Object(window.history.state), historyKey))

const keepInHistory = (pages: CursorPages) =>
  window.history.replaceState({ ...Object(window.history.state), [historyKey]: pages }, '')

/**
 * The shown page of a cursor-paginated table; `key` names its filters (others: first page).
 * `remember`: the page survives leaving the table and coming back to it in history.
 */
export const useCursorPages = (key: string, { remember = false }: { remember?: boolean } = {}) => {
  const [stored, setStored] = useState(
    () => (remember ? rememberedPages() : undefined) ?? firstPage(key),
  )
  const pages = useMemo(() => pagesFor(stored, key), [stored, key])
  useEffect(() => {
    if (remember) keepInHistory(pages)
  }, [remember, pages])
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
