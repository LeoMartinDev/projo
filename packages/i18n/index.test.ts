import { describe, expect, test } from 'bun:test'

import { isLocale, matchLocale } from './index.ts'

describe('interface language (§19)', () => {
  test('the first supported language of the preferences, whatever its region', () => {
    expect(matchLocale(['en-GB', 'fr-FR'])).toBe('en')
    expect(matchLocale(['de-DE', 'FR-ca'])).toBe('fr')
  })

  test('French when none is supported', () => {
    expect(matchLocale(['de', 'es-ES'])).toBe('fr')
    expect(matchLocale([])).toBe('fr')
  })

  test('only the shipped locales are locales', () => {
    expect(isLocale('en')).toBe(true)
    expect(isLocale('en-US')).toBe(false)
  })
})
