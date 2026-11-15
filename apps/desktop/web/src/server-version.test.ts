import { expect, test } from 'bun:test'

import { isServerCompatible } from './server-version.ts'

test('a server at or above the minimum is compatible', () => {
  expect(isServerCompatible('1.25.0', '1.25.0')).toBe(true)
  expect(isServerCompatible('1.25.3', '1.25.0')).toBe(true)
  expect(isServerCompatible('1.30.0', '1.25.0')).toBe(true)
  expect(isServerCompatible('2.0.0', '1.25.0')).toBe(true)
  expect(isServerCompatible('v1.25.0+build.4', '1.25.0')).toBe(true)
})

test('an older server, or a pre-release of the minimum, is not', () => {
  expect(isServerCompatible('1.24.9', '1.25.0')).toBe(false)
  expect(isServerCompatible('0.99.0', '1.25.0')).toBe(false)
  expect(isServerCompatible('1.25.0-rc.1', '1.25.0')).toBe(false)
})

test('an unreadable version is not', () => {
  expect(isServerCompatible('dev', '1.25.0')).toBe(false)
  expect(isServerCompatible('', '1.25.0')).toBe(false)
})
