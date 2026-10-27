import { expect, test } from 'bun:test'

import { isLiveRefetchable } from './live-refresh.ts'

test('isLiveRefetchable: plain queries and single-page lists only', () => {
  const query = (data: unknown) => ({ state: { data } })
  expect(isLiveRefetchable(query(undefined))).toBe(true)
  expect(isLiveRefetchable(query({ items: [] }))).toBe(true)
  expect(isLiveRefetchable(query({ pages: [{}], pageParams: [''] }))).toBe(true)
  expect(isLiveRefetchable(query({ pages: [{}, {}], pageParams: ['', 'c'] }))).toBe(false)
})
