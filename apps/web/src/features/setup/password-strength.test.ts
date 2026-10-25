import { expect, test } from 'bun:test'

import { passwordScore } from './password-strength.ts'

test('an empty password scores 0', () => {
  expect(passwordScore('')).toBe(0)
})

test('each criterion adds a point', () => {
  expect(passwordScore('abc')).toBe(0)
  expect(passwordScore('abcdefgh')).toBe(1)
  expect(passwordScore('abcdefghijkl')).toBe(2)
  expect(passwordScore('Abcdefghijkl')).toBe(3)
  expect(passwordScore('Marée-basse-112')).toBe(4)
})

test('a symbol counts like a long password', () => {
  expect(passwordScore('abc-defg')).toBe(2)
})
