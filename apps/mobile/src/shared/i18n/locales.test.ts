import { describe, expect, test } from 'bun:test'

import type { ConnectionErrorCode } from '../../features/server-connection/connection-error.ts'
import en from './en.json'
import fr from './fr.json'
import { detectLocale } from './locale.ts'

/** Flattens `{ a: { b: 'x' } }` into `['a.b']`. Error keys keep their `/`. */
const keysOf = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && Object(value) === value
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        keysOf(child, prefix === '' ? key : `${prefix}.${key}`),
      )
    : [prefix]

const errorCodes = {
  'connection/invalid_url': true,
  'connection/not_projo': true,
  network: true,
  unknown: true,
} satisfies Record<ConnectionErrorCode, true>

describe('locales', () => {
  test('en has exactly the keys of fr', () => {
    expect(keysOf(en).sort()).toEqual(keysOf(fr).sort())
  })

  for (const [locale, messages] of Object.entries({ fr, en })) {
    test(`every connection error code has a ${locale} message`, () => {
      const table: Record<string, string | undefined> = messages.errors
      const missing = Object.keys(errorCodes).filter((code) => (table[code] ?? '').trim() === '')
      expect(missing).toEqual([])
    })
  }
})

describe('detectLocale', () => {
  test('first supported device language, French otherwise', () => {
    expect(detectLocale(['en-GB', 'fr-FR'])).toBe('en')
    expect(detectLocale(['de-DE', 'fr-CA'])).toBe('fr')
    expect(detectLocale(['de-DE'])).toBe('fr')
    expect(detectLocale([])).toBe('fr')
  })
})
