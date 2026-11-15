import { expect, test } from 'bun:test'

import { toggleLibrary } from './library-access.ts'

test('ticking the only library keeps the selection instead of granting every library', () => {
  expect(
    toggleLibrary({ libraryAccess: 'selected', libraryIds: [] }, ['kids'], 'kids', true),
  ).toEqual({ libraryAccess: 'selected', libraryIds: ['kids'] })
})

test('unticking a library under "all" selects the others', () => {
  expect(
    toggleLibrary({ libraryAccess: 'all', libraryIds: [] }, ['films', 'kids'], 'films', false),
  ).toEqual({ libraryAccess: 'selected', libraryIds: ['kids'] })
})
