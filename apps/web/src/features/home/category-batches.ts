import type { HomeCategoriesDto } from '@projo/shared/api/home'

/**
 * Category rows to reserve for the next batch (§13.3, AGENTS.md: no layout shift when it comes):
 * the size of a batch (the first one's), never more than what is left of the list (`total`); 0
 * after the last batch.
 */
export const reservedRows = (pages: readonly HomeCategoriesDto[]): number => {
  const [first] = pages
  const last = pages.at(-1)
  if (first === undefined || last?.nextCursor === undefined) return 0
  const loaded = pages.reduce((sum, page) => sum + page.rows.length, 0)
  return Math.max(0, Math.min(first.rows.length, last.total - loaded))
}
