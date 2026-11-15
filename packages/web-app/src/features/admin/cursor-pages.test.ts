import { expect, test } from 'bun:test'

import {
  currentCursor,
  firstPage,
  nextPage,
  pageNumber,
  pagesFor,
  previousPage,
} from './cursor-pages.ts'

test('starts on the first page, without a cursor', () => {
  const pages = firstPage('all')
  expect(currentCursor(pages)).toBe('')
  expect(pageNumber(pages)).toBe(1)
})

test('goes forward with the cursor of the shown page and back the same way', () => {
  const third = nextPage(nextPage(firstPage('all'), 'c1'), 'c2')
  expect(currentCursor(third)).toBe('c2')
  expect(pageNumber(third)).toBe(3)
  const second = previousPage(third)
  expect(currentCursor(second)).toBe('c1')
  expect(pageNumber(second)).toBe(2)
})

test('stays on the first page when going back from it', () => {
  const pages = firstPage('all')
  expect(previousPage(pages)).toBe(pages)
})

test('keeps the pages for the same filters and starts again for others', () => {
  const second = nextPage(firstPage('all'), 'c1')
  expect(pagesFor(second, 'all')).toBe(second)
  expect(pagesFor(second, 'failed')).toEqual(firstPage('failed'))
})
