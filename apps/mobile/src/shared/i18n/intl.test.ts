import { expect, test } from 'bun:test'

import { formatRelative, languageName } from './intl.ts'

test('a language is named in the locale, capitalised', () => {
  expect(languageName('ja', 'fr')).toBe('Japonais')
  expect(languageName('fr', 'fr')).toBe('Français')
})

test('without Intl.DisplayNames (Hermes), the language in itself', () => {
  const { DisplayNames } = Intl
  Object.assign(Intl, { DisplayNames: undefined })
  expect(languageName('ja', 'fr')).toBe('日本語')
  expect(languageName('xx', 'fr')).toBe('XX')
  // Track tags (ffprobe): ISO 639-2, bibliographic forms included.
  expect(languageName('fre', 'fr')).toBe('Français')
  expect(languageName('eng', 'fr')).toBe('English')
  Object.assign(Intl, { DisplayNames })
})

test('the last activity reads relative to now', () => {
  const now = new Date('2026-10-26T12:00:00Z')
  expect(formatRelative('2026-10-26T11:55:00Z', 'en', now)).toBe('5 min. ago')
  expect(formatRelative('2026-10-25T12:00:00Z', 'en', now)).toBe('yesterday')
})
