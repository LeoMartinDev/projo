import { describe, expect, test } from 'bun:test'

import { toSearchExpression } from './search.ts'

describe('search expression', () => {
  test('every word becomes a required prefix', () => {
    expect(toSearchExpression('Amélie  poul')).toBe('"Amélie"* "poul"*')
  })

  test('FTS5 syntax in the input is neutralized', () => {
    expect(toSearchExpression('"star" OR wars* -x (a:b)')).toBe(
      '"star"* "OR"* "wars"* "x"* "a"* "b"*',
    )
  })

  test('below 2 characters or without a word: nothing to search', () => {
    expect(toSearchExpression('a')).toBeUndefined()
    expect(toSearchExpression(' a ')).toBeUndefined()
    expect(toSearchExpression('?!')).toBeUndefined()
    expect(toSearchExpression('ab')).toBe('"ab"*')
  })
})
