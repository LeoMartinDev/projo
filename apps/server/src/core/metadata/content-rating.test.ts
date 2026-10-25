import { describe, expect, test } from 'bun:test'

import { pickContentRating } from './content-rating.ts'

describe('pickContentRating (§9.1)', () => {
  test("the library's country first", () => {
    expect(
      pickContentRating(
        [
          { country: 'US', rating: 'TV-MA' },
          { country: 'FR', rating: '16' },
        ],
        'FR',
      ),
    ).toEqual({ rating: '16', country: 'FR' })
  })

  test('US when the country has none, empty certifications ignored', () => {
    expect(
      pickContentRating(
        [
          { country: 'FR', rating: '', type: 3 },
          { country: 'US', rating: 'PG-13', type: 3 },
        ],
        'FR',
      ),
    ).toEqual({ rating: 'PG-13', country: 'US' })
  })

  test('movies: the theatrical release wins over the others', () => {
    expect(
      pickContentRating(
        [
          { country: 'DE', rating: '16', type: 6 },
          { country: 'DE', rating: '12', type: 3 },
          { country: 'DE', rating: '12', type: 5 },
        ],
        'de',
      ),
    ).toEqual({ rating: '12', country: 'DE' })
  })

  test('nothing anywhere: none', () => {
    expect(pickContentRating([{ country: 'GB', rating: '15' }], 'FR')).toBeUndefined()
    expect(pickContentRating([], 'FR')).toBeUndefined()
  })
})
