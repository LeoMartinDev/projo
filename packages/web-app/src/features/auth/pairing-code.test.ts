import { expect, test } from 'bun:test'

import { normalizePairingCode } from './pairing-code.ts'

test('a code reads as the server issued it, however it was typed', () => {
  expect(normalizePairingCode('abc 234')).toBe('ABC234')
  expect(normalizePairingCode(' ABC-234 ')).toBe('ABC234')
  expect(normalizePairingCode('abc–234')).toBe('ABC234')
  expect(normalizePairingCode('')).toBe('')
})
