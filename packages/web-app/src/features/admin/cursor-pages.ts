import { z } from 'zod'

/**
 * Pages of a cursor-paginated list (`?cursor=&limit=`): the cursors of the pages from the
 * first one ('') to the shown one, so "previous" goes back without the server knowing pages.
 * `key` names the filters: other filters start again from the first page.
 */
export type CursorPages = { key: string; cursors: readonly string[] }

export const firstPage = (key: string): CursorPages => ({ key, cursors: [''] })

/** The pages for these filters: the same pages, or the first one when the filters changed. */
export const pagesFor = (pages: CursorPages, key: string): CursorPages =>
  pages.key === key ? pages : firstPage(key)

export const currentCursor = (pages: CursorPages): string => pages.cursors.at(-1) ?? ''

/** 1 for the first page. */
export const pageNumber = (pages: CursorPages): number => pages.cursors.length

export const nextPage = (pages: CursorPages, nextCursor: string): CursorPages => ({
  key: pages.key,
  cursors: [...pages.cursors, nextCursor],
})

export const previousPage = (pages: CursorPages): CursorPages =>
  pages.cursors.length <= 1 ? pages : { key: pages.key, cursors: pages.cursors.slice(0, -1) }

const storedPagesSchema = z.object({
  key: z.string(),
  cursors: z.tuple([z.literal('')], z.string()),
})

/** Pages kept in a history entry (`remember` of `useCursorPages`), or nothing if they are not. */
export const storedPages = (value: unknown): CursorPages | undefined => {
  const parsed = storedPagesSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}
