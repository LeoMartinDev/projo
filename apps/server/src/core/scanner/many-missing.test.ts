import { describe, expect, test } from 'bun:test'

import { assessManyMissing, commonFolder, isManyMissing } from './many-missing.ts'

const files = (rootId: string, folder: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    rootId,
    relativePath: `${folder}/Show ${index}/S01E01.mkv`,
  }))

describe('§7.5 many files missing at once', () => {
  test('needs at least 20 files and 10 % of the library', () => {
    expect(isManyMissing({ missing: 19, tracked: 19 })).toBe(false)
    expect(isManyMissing({ missing: 20, tracked: 200 })).toBe(true)
    expect(isManyMissing({ missing: 20, tracked: 201 })).toBe(false)
    expect(isManyMissing({ missing: 500, tracked: 4000 })).toBe(true)
  })

  test('the common folder is the deepest one holding every path', () => {
    expect(commonFolder(['disk2/Films/A.mkv', 'disk2/Films/B/B.mkv'])).toBe('disk2/Films')
    expect(commonFolder(['disk2/Films/A.mkv', 'disk2/Shows/B.mkv'])).toBe('disk2')
    expect(commonFolder(['A.mkv', 'disk2/B.mkv'])).toBe('')
    expect(commonFolder(['disk2/Films/A.mkv'])).toBe('disk2/Films')
    expect(commonFolder([])).toBe('')
  })

  test('reports the count and the folder of the root that lost the most', () => {
    expect(assessManyMissing({ newlyMissing: files('root', 'disk2', 19), tracked: 20 })).toBe(
      undefined,
    )
    expect(
      assessManyMissing({
        newlyMissing: [...files('a', 'disk1', 3), ...files('b', 'disk2/Shows', 22)],
        tracked: 100,
      }),
    ).toEqual({ count: 25, rootId: 'b', folder: 'disk2/Shows' })
  })
})
